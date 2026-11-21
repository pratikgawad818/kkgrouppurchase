-- 0096: controlled pricing changes and spreadsheet flat import.
-- The shared units table remains the only flat master; all changes are audited.
CREATE TABLE public.property_unit_price_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 old_values jsonb NOT NULL,
 new_values jsonb NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason))>=10),
 revised_by uuid NOT NULL REFERENCES public.profiles(id),
 revised_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX property_unit_price_revisions_unit_idx ON public.property_unit_price_revisions(unit_id,revised_at DESC);
ALTER TABLE public.property_unit_price_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_unit_price_revisions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.property_unit_price_revisions TO authenticated;
CREATE POLICY "View assigned unit price changes" ON public.property_unit_price_revisions
 FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.units u WHERE u.id=unit_id
    AND public.sales_project_allowed(u.project_id) AND public.actor_in_company(company_id))
 );

CREATE OR REPLACE FUNCTION public.sales_reprice_flat(
 _unit_id uuid,_base_rate numeric,_floor_rise numeric,_parking numeric,
 _other numeric,_gst numeric,_reason text
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE old_unit public.units%ROWTYPE;new_unit public.units%ROWTYPE;c uuid;
BEGIN
 IF NOT public.sales_manager() THEN RAISE EXCEPTION 'Director / Super Admin only'; END IF;
 SELECT * INTO old_unit FROM public.units WHERE id=_unit_id FOR UPDATE;
 IF NOT FOUND OR old_unit.record_status<>'active' OR old_unit.status<>'available'
    OR NOT public.sales_project_allowed(old_unit.project_id) THEN
   RAISE EXCEPTION 'Only accessible available flats can be repriced'; END IF;
 SELECT company_id INTO c FROM public.projects WHERE id=old_unit.project_id;
 IF NOT public.actor_in_company(c) THEN RAISE EXCEPTION 'Wrong company'; END IF;
 IF _base_rate IS NULL OR _base_rate<=0 OR _floor_rise IS NULL OR _floor_rise<0
 OR _parking IS NULL OR _parking<0 OR _other IS NULL OR _other<0
 OR _gst IS NULL OR _gst NOT BETWEEN 0 AND 28 THEN
   RAISE EXCEPTION 'Rates, charges and tax must be valid nonnegative amounts'; END IF;
 IF length(btrim(coalesce(_reason,'')))<10 THEN RAISE EXCEPTION 'Price revision reason required'; END IF;
 UPDATE public.units SET base_rate=_base_rate,floor_rise_rate=_floor_rise,
  parking_charges=_parking,other_charges=_other,gst_rate=_gst
 WHERE id=_unit_id RETURNING * INTO new_unit;
 IF old_unit.base_rate IS NOT DISTINCT FROM new_unit.base_rate
 AND old_unit.floor_rise_rate IS NOT DISTINCT FROM new_unit.floor_rise_rate
 AND old_unit.parking_charges IS NOT DISTINCT FROM new_unit.parking_charges
 AND old_unit.other_charges IS NOT DISTINCT FROM new_unit.other_charges
 AND old_unit.gst_rate IS NOT DISTINCT FROM new_unit.gst_rate THEN
  RAISE EXCEPTION 'No pricing fields changed'; END IF;
 INSERT INTO public.property_unit_price_revisions(
  unit_id,company_id,old_values,new_values,reason,revised_by)
 VALUES (_unit_id,c,
  jsonb_build_object('base_rate',old_unit.base_rate,'floor_rise',old_unit.floor_rise_rate,
    'parking',old_unit.parking_charges,'other',old_unit.other_charges,
    'gst',old_unit.gst_rate,'agreement_value',old_unit.total_agreement_value),
  jsonb_build_object('base_rate',new_unit.base_rate,'floor_rise',new_unit.floor_rise_rate,
    'parking',new_unit.parking_charges,'other',new_unit.other_charges,
    'gst',new_unit.gst_rate,'agreement_value',new_unit.total_agreement_value),
  btrim(_reason),auth.uid());
 RETURN new_unit.total_agreement_value;
END $$;
REVOKE ALL ON FUNCTION public.sales_reprice_flat(uuid,numeric,numeric,numeric,numeric,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_reprice_flat(uuid,numeric,numeric,numeric,numeric,numeric,text) TO authenticated;

-- CSV/Excel-parsed rows are validated by PostgreSQL independently of the
-- client parser. Dry-run performs every check but writes nothing.
CREATE OR REPLACE FUNCTION public.sales_import_flat_rows(
 _building_id uuid,_rows jsonb,_dry_run boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE p uuid;c uuid;r jsonb;idx integer:=0;fn integer;fid uuid;
 number text;type_name text;type_code public.unit_type;
 carpet numeric;built numeric;area numeric;rate numeric;parking numeric;other_charge numeric;gst numeric;
 seen text[]:=ARRAY[]::text[]; added integer:=0;
BEGIN
 IF NOT public.sales_manager() THEN RAISE EXCEPTION 'Director / Super Admin only'; END IF;
 SELECT b.project_id,pr.company_id INTO p,c FROM public.buildings b
  JOIN public.projects pr ON pr.id=b.project_id WHERE b.id=_building_id;
 IF p IS NULL OR NOT public.sales_project_allowed(p) OR NOT public.actor_in_company(c) THEN
  RAISE EXCEPTION 'Building is not accessible'; END IF;
 IF _rows IS NULL OR jsonb_typeof(_rows) IS DISTINCT FROM 'array'
    OR jsonb_array_length(_rows) NOT BETWEEN 1 AND 300 THEN
  RAISE EXCEPTION 'Import 1 to 300 rows per batch'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(_rows) LOOP
  idx:=idx+1;
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR
     coalesce(r->>'floor_number','') !~ '^-?[0-9]{1,3}$' THEN
     RAISE EXCEPTION 'Row %: valid floor_number is required',idx; END IF;
  fn:=(r->>'floor_number')::integer;
  SELECT id INTO fid FROM public.floors
   WHERE building_id=_building_id AND floor_number=fn;
  IF fid IS NULL THEN RAISE EXCEPTION 'Row %: floor % is not in this building',idx,fn; END IF;
  number:=btrim(coalesce(r->>'flat_number',''));
  IF length(number) NOT BETWEEN 1 AND 50 OR number=ANY(seen) THEN
    RAISE EXCEPTION 'Row %: flat number is missing, too long or duplicated in file',idx; END IF;
  seen:=array_append(seen,number);
  IF EXISTS(SELECT 1 FROM public.units u
    WHERE u.building_id=_building_id AND u.unit_number=number) THEN
    RAISE EXCEPTION 'Row %: flat % already exists in this building',idx,number; END IF;
  type_name:=coalesce(r->>'type','');
  SELECT e.enumlabel::text INTO type_name FROM pg_enum e
   JOIN pg_type t ON t.oid=e.enumtypid
   WHERE t.typname='unit_type' AND e.enumlabel::text=type_name;
  IF type_name IS NULL THEN RAISE EXCEPTION 'Row %: unknown flat type',idx; END IF;
  type_code:=type_name::public.unit_type;
  IF coalesce(r->>'carpet_area','') !~ '^[0-9]{1,10}([.][0-9]{1,3})?$'
    OR coalesce(r->>'built_up_area','') !~ '^[0-9]{1,10}([.][0-9]{1,3})?$'
    OR coalesce(r->>'saleable_area','') !~ '^[0-9]{1,10}([.][0-9]{1,3})?$'
    OR coalesce(r->>'rate','') !~ '^[0-9]{1,10}([.][0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Row %: enter valid areas and rate',idx; END IF;
  carpet:=(r->>'carpet_area')::numeric;built:=(r->>'built_up_area')::numeric;
  area:=(r->>'saleable_area')::numeric;rate:=(r->>'rate')::numeric;
  IF carpet<=0 OR built<carpet OR area<built OR rate<=0 THEN
    RAISE EXCEPTION 'Row %: carpet <= built-up <= saleable and rate > 0 required',idx; END IF;
  IF coalesce(r->>'parking','0') !~ '^[0-9]{1,10}([.][0-9]{1,2})?$'
     OR coalesce(r->>'other','0') !~ '^[0-9]{1,10}([.][0-9]{1,2})?$'
     OR coalesce(r->>'gst','5') !~ '^[0-9]{1,2}([.][0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'Row %: invalid charges/tax',idx; END IF;
  parking:=coalesce((r->>'parking')::numeric,0);
  other_charge:=coalesce((r->>'other')::numeric,0);
  gst:=coalesce((r->>'gst')::numeric,5);
  IF gst NOT BETWEEN 0 AND 28 THEN RAISE EXCEPTION 'Row %: GST exceeds allowed range',idx; END IF;
  IF NOT _dry_run THEN
   INSERT INTO public.units(project_id,building_id,floor_id,unit_number,
    unit_type,carpet_area,built_up_area,saleable_area,base_rate,
    parking_charges,other_charges,gst_rate,status)
   VALUES(p,_building_id,fid,number,type_code,carpet,built,area,rate,
    parking,other_charge,gst,'available'::public.unit_status);
   added:=added+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('validated',idx,'created',added,'dry_run',_dry_run);
END $$;
REVOKE ALL ON FUNCTION public.sales_import_flat_rows(uuid,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_import_flat_rows(uuid,jsonb,boolean) TO authenticated;
