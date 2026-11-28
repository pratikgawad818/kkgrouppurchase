-- Flat inventory is master data, not a sales operator entry.
CREATE OR REPLACE FUNCTION public.sales_add_flat(_floor_id uuid, _number text, _type unit_type, _carpet numeric, _built_up numeric, _saleable numeric, _rate numeric, _parking numeric DEFAULT 0, _other numeric DEFAULT 0, _gst numeric DEFAULT 5)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_project uuid;v_id uuid;
BEGIN
 IF NOT public.sales_manager() OR public.is_project_sales_staff(auth.uid()) THEN RAISE EXCEPTION 'Only Director or Super Admin may add flat inventory';END IF;
 SELECT b.project_id INTO v_project FROM public.floors f
 JOIN public.buildings b ON b.id=f.building_id WHERE f.id=_floor_id;
 IF v_project IS NULL OR NOT public.sales_project_allowed(v_project) THEN
   RAISE EXCEPTION 'Floor not accessible';END IF;
 IF length(btrim(coalesce(_number,''))) NOT BETWEEN 1 AND 50 THEN
   RAISE EXCEPTION 'Flat number is required';END IF;
 INSERT INTO public.units(project_id,building_id,floor_id,unit_number,unit_type,
   carpet_area,built_up_area,saleable_area,base_rate,parking_charges,
   other_charges,gst_rate,status)
 SELECT v_project,f.building_id,f.id,btrim(_number),_type,
   _carpet,_built_up,_saleable,_rate,coalesce(_parking,0),
   coalesce(_other,0),coalesce(_gst,5),'available'::public.unit_status
 FROM public.floors f WHERE f.id=_floor_id
 RETURNING id INTO v_id;
 RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.sales_bulk_add_flats(_building_id uuid, _floor_ids uuid[], _per_floor integer, _start_at integer, _digits integer, _separator text, _type unit_type, _carpet numeric, _built_up numeric, _saleable numeric, _rate numeric, _parking numeric DEFAULT 0, _other numeric DEFAULT 0, _gst numeric DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE project_id uuid;company_id uuid; floor_count integer; generated integer;
BEGIN
 IF NOT public.sales_manager() OR public.is_project_sales_staff(auth.uid()) THEN RAISE EXCEPTION 'Only Director or Super Admin may add flat inventory'; END IF;
 SELECT b.project_id,p.company_id INTO project_id,company_id
 FROM public.buildings b JOIN public.projects p ON p.id=b.project_id
 WHERE b.id=_building_id;
 IF project_id IS NULL OR NOT public.sales_project_allowed(project_id)
    OR NOT public.actor_in_company(company_id) THEN
   RAISE EXCEPTION 'Building is not accessible'; END IF;
 IF _floor_ids IS NULL OR array_length(_floor_ids,1) NOT BETWEEN 1 AND 80
   OR _per_floor NOT BETWEEN 1 AND 50 OR _start_at NOT BETWEEN 0 AND 999
   OR _digits NOT BETWEEN 1 AND 4 OR _separator !~ '^[A-Za-z0-9-]{0,3}$' THEN
   RAISE EXCEPTION 'Select floors and valid flat numbering options'; END IF;
 IF _carpet IS NULL OR _carpet<=0 OR _built_up<_carpet OR _saleable<_built_up
   OR _rate IS NULL OR _rate<=0 OR _parking<0 OR _other<0 OR _gst NOT BETWEEN 0 AND 28 THEN
   RAISE EXCEPTION 'Enter valid areas, rate and charges'; END IF;
 IF cardinality(_floor_ids)*_per_floor>1200 THEN
   RAISE EXCEPTION 'Create at most 1200 flats in one batch'; END IF;
 SELECT count(*) INTO floor_count FROM public.floors f
 WHERE f.id=ANY(_floor_ids) AND f.building_id=_building_id;
 IF floor_count IS DISTINCT FROM cardinality(_floor_ids)
 OR floor_count IS DISTINCT FROM (SELECT count(DISTINCT u) FROM unnest(_floor_ids) u) THEN
   RAISE EXCEPTION 'All selected floors must be distinct and belong to this building'; END IF;
 IF _start_at+_per_floor-1>9999 THEN
   RAISE EXCEPTION 'Flat number exceeds allowed range'; END IF;
 -- Any duplicate flat number aborts the entire transaction; never silently
 -- overwrite a booked flat or create only some rows in a batch.
 INSERT INTO public.units(project_id,building_id,floor_id,unit_number,unit_type,
   carpet_area,built_up_area,saleable_area,base_rate,parking_charges,other_charges,gst_rate,status)
 SELECT project_id,_building_id,f.id,
   f.floor_number::text||_separator||lpad(i::text,_digits,'0'),_type,
   _carpet,_built_up,_saleable,_rate,coalesce(_parking,0),coalesce(_other,0),
   coalesce(_gst,5),'available'::public.unit_status
 FROM public.floors f
 CROSS JOIN LATERAL generate_series(_start_at,_start_at+_per_floor-1) i
 WHERE f.id=ANY(_floor_ids) AND f.building_id=_building_id;
 GET DIAGNOSTICS generated=ROW_COUNT;
 IF generated<>floor_count*_per_floor THEN
   RAISE EXCEPTION 'Bulk flat count mismatch; no changes committed'; END IF;
 RETURN generated;
END $function$;

CREATE OR REPLACE FUNCTION public.sales_import_flat_rows(_building_id uuid, _rows jsonb, _dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p uuid;c uuid;r jsonb;idx integer:=0;fn integer;fid uuid;
 number text;type_name text;type_code public.unit_type;
 carpet numeric;built numeric;area numeric;rate numeric;parking numeric;other_charge numeric;gst numeric;
 seen text[]:=ARRAY[]::text[]; added integer:=0;
BEGIN
 IF NOT public.sales_manager() OR public.is_project_sales_staff(auth.uid()) THEN RAISE EXCEPTION 'Only Director or Super Admin may add flat inventory'; END IF;
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
END $function$;
