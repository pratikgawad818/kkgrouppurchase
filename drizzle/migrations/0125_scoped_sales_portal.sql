-- Scoped sales roles: no broad financial or project-wide permissions.
CREATE OR REPLACE FUNCTION public.is_project_sales_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT public.has_role(_user_id,'ceo'::public.app_role) OR public.has_role(_user_id,'senior_sales_executive'::public.app_role)
$$;
REVOKE ALL ON FUNCTION public.is_project_sales_staff(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_project_sales_staff(uuid) TO authenticated;
INSERT INTO public.role_permissions(role,permission_code) VALUES
 ('ceo','units.view'),('ceo','sales.bookings'),('ceo','sales.collections'),('ceo','small_expense.create'),
 ('senior_sales_executive','small_expense.create') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.can_access_project(_user_id uuid, _project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.projects project
    JOIN public.profiles actor ON actor.id=_user_id
    WHERE project.id=_project_id AND actor.is_active
      AND actor.company_id=project.company_id
      AND (
        (public.has_permission(_user_id,'projects.view_all') AND NOT public.is_project_sales_staff(_user_id))
        OR EXISTS (
          SELECT 1 FROM public.user_project_assignments assignment
          WHERE assignment.user_id=_user_id
            AND assignment.project_id=project.id
        )
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.can_view_site_small_expense_bill(_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT EXISTS (
   SELECT 1 FROM public.site_small_expense_bills b
   JOIN public.site_small_expenses e ON e.id=b.expense_id
   WHERE b.storage_path=_path AND b.is_active
     AND b.company_id=e.company_id
     AND public.actor_in_company(e.company_id)
     AND (NOT public.is_project_sales_staff(auth.uid()) OR (e.project_id IS NOT NULL AND public.can_access_project(auth.uid(),e.project_id)))
     AND (
       (public.is_project_sales_staff(auth.uid()) AND public.has_permission(auth.uid(),'small_expense.create') AND e.project_id IS NOT NULL AND public.can_access_project(auth.uid(),e.project_id))
       OR (
         public.has_permission(auth.uid(),'financial.view')
         AND (e.project_id IS NULL OR public.can_access_project(auth.uid(),e.project_id))
       )
       OR (
         public.has_permission(auth.uid(),'small_expense.create')
         AND public.has_role(auth.uid(),'site_engineer')
         AND e.created_by=auth.uid()
         AND e.project_id IS NOT NULL
         AND public.can_access_project(auth.uid(),e.project_id)
       )
     )
 );
$function$;

CREATE OR REPLACE FUNCTION public.manage_site_small_expense_bill(_expense_id uuid, _path text, _file_name text DEFAULT NULL::text, _mime_type text DEFAULT NULL::text, _bytes bigint DEFAULT NULL::bigint, _remove boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE actor uuid := auth.uid(); current_company uuid;
        expense public.site_small_expenses%ROWTYPE; bill public.site_small_expense_bills%ROWTYPE;
        result_id uuid; object_mime text; object_bytes bigint;
        site_only boolean := false;
BEGIN
  SELECT company_id INTO current_company FROM public.profiles
    WHERE id=actor AND is_active;
  site_only := (public.has_role(actor,'site_engineer') OR public.is_project_sales_staff(actor))
    AND public.has_permission(actor,'small_expense.create')
    AND NOT public.has_role(actor,'super_admin')
    AND NOT public.has_role(actor,'accounts_manager')
    AND NOT public.has_role(actor,'director');
  IF current_company IS NULL OR NOT (
    (public.has_permission(actor,'small_expense.manage') AND
      (public.has_role(actor,'super_admin') OR
       (public.has_role(actor,'accounts_manager') AND NOT public.has_role(actor,'director'))))
    OR site_only
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage expense bills'; END IF;
  SELECT * INTO expense FROM public.site_small_expenses WHERE id=_expense_id FOR UPDATE;
  IF NOT FOUND OR expense.company_id<>current_company OR expense.status<>'recorded'
    OR (expense.project_id IS NOT NULL AND NOT public.can_access_project(actor,expense.project_id))
    OR (site_only AND (
      expense.created_by IS DISTINCT FROM actor OR expense.project_id IS NULL
    )) THEN
    RAISE EXCEPTION 'Expense is not accessible for bill changes'; END IF;

  IF _remove THEN
    SELECT * INTO bill FROM public.site_small_expense_bills
      WHERE storage_path=_path AND expense_id=_expense_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bill does not belong to this expense'; END IF;
    IF site_only AND bill.created_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'Site Engineers may remove only their own uploaded bills';
    END IF;
    IF NOT bill.is_active THEN RETURN bill.id; END IF;
    UPDATE public.site_small_expense_bills SET is_active=false,
      removed_at=now(),removed_by=actor WHERE id=bill.id;
    INSERT INTO public.site_small_expense_events(company_id,expense_id,action,actor_id,reason)
      VALUES(current_company,_expense_id,'bill_removed',actor,'Removed bill: '||bill.file_name);
    result_id := bill.id;
  ELSE
    IF _path IS NULL OR split_part(_path,'/',1)<>current_company::text
      OR split_part(_path,'/',2)<>actor::text
      OR _path !~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$'
      OR char_length(btrim(coalesce(_file_name,''))) NOT BETWEEN 1 AND 200
      OR _mime_type NOT IN ('image/jpeg','image/png','image/webp','application/pdf')
      OR _bytes IS NULL OR _bytes NOT BETWEEN 1 AND 10485760 THEN
      RAISE EXCEPTION 'Upload a valid PDF or bill image from your account'; END IF;
    SELECT o.metadata->>'mimetype',nullif(o.metadata->>'size','')::bigint
      INTO object_mime,object_bytes FROM storage.objects o
      WHERE o.bucket_id='small-expense-bills' AND o.name=_path;
    IF NOT FOUND OR object_mime IS DISTINCT FROM _mime_type
      OR object_bytes IS DISTINCT FROM _bytes THEN
      RAISE EXCEPTION 'Uploaded bill content does not match its metadata'; END IF;
    SELECT id INTO result_id FROM public.site_small_expense_bills
      WHERE storage_path=_path AND expense_id=_expense_id AND is_active;
    IF FOUND THEN RETURN result_id; END IF;
    IF EXISTS (SELECT 1 FROM public.site_small_expense_bills WHERE storage_path=_path) THEN
      RAISE EXCEPTION 'This bill is already attached or archived'; END IF;
    IF (SELECT count(*) FROM public.site_small_expense_bills
      WHERE expense_id=_expense_id AND is_active)>=8 THEN
      RAISE EXCEPTION 'Maximum 8 active bills per expense'; END IF;
    INSERT INTO public.site_small_expense_bills
      (company_id,expense_id,storage_path,file_name,mime_type,byte_size,created_by)
    VALUES(current_company,_expense_id,_path,btrim(_file_name),_mime_type,_bytes,actor)
      RETURNING id INTO result_id;
    INSERT INTO public.site_small_expense_events(company_id,expense_id,action,actor_id,reason)
      VALUES(current_company,_expense_id,'bill_added',actor,'Added bill: '||btrim(_file_name));
  END IF;
  UPDATE public.site_small_expenses SET updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
    WHERE id=_expense_id;
  RETURN result_id;
END $function$;

CREATE OR REPLACE FUNCTION public.record_site_small_expense(_entry_key uuid, _project_id uuid, _building_id uuid, _spent_on date, _category text, _amount numeric, _payment_method text, _paid_to text, _description text, _receipt_reference text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE current_company uuid; inserted_id uuid; prior public.site_small_expenses%ROWTYPE;
  clean_ref text := NULLIF(btrim(coalesce(_receipt_reference,'')),'');
  clean_payee text := btrim(coalesce(_paid_to,''));
  clean_description text := btrim(coalesce(_description,''));
BEGIN
  SELECT company_id INTO current_company FROM public.profiles
    WHERE id=auth.uid() AND is_active;
  IF current_company IS NULL OR NOT (
      (public.has_permission(auth.uid(),'small_expense.manage') AND (
        public.has_role(auth.uid(),'super_admin') OR
        (public.has_role(auth.uid(),'accounts_manager') AND NOT public.has_role(auth.uid(),'director'))
      ))
      OR
      (public.has_permission(auth.uid(),'small_expense.create')
       AND (public.has_role(auth.uid(),'site_engineer') OR public.is_project_sales_staff(auth.uid()))
       AND NOT public.has_role(auth.uid(),'director')
       AND NOT public.has_role(auth.uid(),'accounts_manager'))
    ) THEN
    RAISE EXCEPTION 'Only an authorized expense recorder can record small expenses';
  END IF;
  -- Field staff must always allocate expenses to a currently assigned site.
  -- They cannot create general office expenses or charge another project.
  IF _project_id IS NULL AND (public.is_project_sales_staff(auth.uid()) OR (public.has_role(auth.uid(),'site_engineer') AND NOT public.has_role(auth.uid(),'super_admin') AND NOT public.has_role(auth.uid(),'accounts_manager'))) THEN
    RAISE EXCEPTION 'Select your assigned project for this expense';
  END IF;
  -- Use the business operating date in India, regardless of the
  -- connection/DB session timezone (usually UTC in cloud hosting).
  IF _entry_key IS NULL OR _spent_on IS NULL OR
    _spent_on>(now() AT TIME ZONE 'Asia/Kolkata')::date
    OR _spent_on<((now() AT TIME ZONE 'Asia/Kolkata')::date - interval '3 years')::date OR
    _category IS NULL OR _category NOT IN ('transport','tea_food','fuel','hardware','site_supplies','repairs','cleaning','labour_incidental','office','security_guard','consultancy','marketing','other')
    OR _amount IS NULL OR _amount <= 0 OR round(_amount,2)<>_amount
    OR _payment_method IS NULL OR _payment_method NOT IN ('cash','upi','bank','card','other')
    OR char_length(clean_payee) NOT BETWEEN 2 AND 120
    OR char_length(clean_description) NOT BETWEEN 3 AND 500
    OR (clean_ref IS NOT NULL AND char_length(clean_ref) NOT BETWEEN 2 AND 120) THEN
    RAISE EXCEPTION 'Invalid date, category, amount, payee, payment or description';
  END IF;
  IF _building_id IS NOT NULL AND _project_id IS NULL THEN
    RAISE EXCEPTION 'Building requires a selected project';
  END IF;
  IF _project_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.projects p WHERE p.id=_project_id
      AND p.company_id=current_company
      AND public.can_access_project(auth.uid(),p.id)
  ) THEN RAISE EXCEPTION 'Project not accessible in current company'; END IF;
  IF _building_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.buildings b WHERE b.id=_building_id AND b.project_id=_project_id
  ) THEN RAISE EXCEPTION 'Building does not belong to selected project'; END IF;

  INSERT INTO public.site_small_expenses (
    company_id,entry_key,project_id,building_id,spent_on,category,amount,
    payment_method,paid_to,description,receipt_reference,created_by
  ) VALUES (
    current_company,_entry_key,_project_id,_building_id,_spent_on,_category,_amount,
    _payment_method,clean_payee,clean_description,clean_ref,auth.uid()
  ) ON CONFLICT(company_id,entry_key) DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NULL THEN
    SELECT * INTO prior FROM public.site_small_expenses
      WHERE company_id=current_company AND entry_key=_entry_key;
    IF prior.id IS NULL OR prior.status<>'recorded'
      OR prior.project_id IS DISTINCT FROM _project_id
      OR prior.building_id IS DISTINCT FROM _building_id
      OR prior.spent_on<>_spent_on OR prior.category<>_category
      OR prior.amount<>_amount OR prior.payment_method<>_payment_method
      OR prior.paid_to<>clean_payee OR prior.description<>clean_description
      OR prior.receipt_reference IS DISTINCT FROM clean_ref THEN
      RAISE EXCEPTION 'An existing expense entry cannot be overwritten or reused';
    END IF;
    RETURN prior.id;
  END IF;
  INSERT INTO public.site_small_expense_events(company_id,expense_id,action,actor_id)
    VALUES(current_company,inserted_id,'recorded',auth.uid());
  RETURN inserted_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.sales_add_flat(_floor_id uuid, _number text, _type unit_type, _carpet numeric, _built_up numeric, _saleable numeric, _rate numeric, _parking numeric DEFAULT 0, _other numeric DEFAULT 0, _gst numeric DEFAULT 5)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_project uuid;v_id uuid;
BEGIN
 IF NOT public.sales_allowed() THEN RAISE EXCEPTION 'Sales access denied';END IF;
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

CREATE OR REPLACE FUNCTION public.sales_allowed()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT auth.uid() IS NOT NULL AND public.is_active_user(auth.uid()) AND
   (public.has_role(auth.uid(),'super_admin'::public.app_role)
    OR public.has_role(auth.uid(),'director'::public.app_role)
    OR public.has_role(auth.uid(),'ceo'::public.app_role)
    OR public.has_role(auth.uid(),'senior_sales_executive'::public.app_role));
$function$;

CREATE OR REPLACE FUNCTION public.sales_bulk_add_flats(_building_id uuid, _floor_ids uuid[], _per_floor integer, _start_at integer, _digits integer, _separator text, _type unit_type, _carpet numeric, _built_up numeric, _saleable numeric, _rate numeric, _parking numeric DEFAULT 0, _other numeric DEFAULT 0, _gst numeric DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE project_id uuid;company_id uuid; floor_count integer; generated integer;
BEGIN
 IF NOT public.sales_allowed() THEN RAISE EXCEPTION 'Sales access denied'; END IF;
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
 IF NOT public.sales_allowed() THEN RAISE EXCEPTION 'Sales access denied'; END IF;
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

-- Additional project-scoped read policy; original site engineer own-only behavior retained.
DROP POLICY IF EXISTS "Assigned sales staff read expenses" ON public.site_small_expenses;
CREATE POLICY "Assigned sales staff read expenses" ON public.site_small_expenses FOR SELECT TO authenticated
USING(public.is_project_sales_staff(auth.uid()) AND public.has_permission(auth.uid(),'small_expense.create')
 AND public.actor_in_company(company_id) AND project_id IS NOT NULL AND public.can_access_project(auth.uid(),project_id));
DROP POLICY IF EXISTS "Assigned sales staff read expense bills" ON public.site_small_expense_bills;
CREATE POLICY "Assigned sales staff read expense bills" ON public.site_small_expense_bills FOR SELECT TO authenticated
USING(public.is_project_sales_staff(auth.uid()) AND public.has_permission(auth.uid(),'small_expense.create')
 AND EXISTS(SELECT 1 FROM public.site_small_expenses e WHERE e.id=expense_id AND e.company_id=site_small_expense_bills.company_id
 AND e.project_id IS NOT NULL AND public.can_access_project(auth.uid(),e.project_id)));
-- Restrictive policies prevent broad grants from exposing office or unassigned expenses.
DROP POLICY IF EXISTS "Sales expense project boundary" ON public.site_small_expenses;
CREATE POLICY "Sales expense project boundary" ON public.site_small_expenses AS RESTRICTIVE FOR SELECT TO authenticated
USING(NOT public.is_project_sales_staff(auth.uid()) OR (project_id IS NOT NULL AND public.can_access_project(auth.uid(),project_id)));
DROP POLICY IF EXISTS "Assigned sales staff upload expense bills" ON storage.objects;
CREATE POLICY "Assigned sales staff upload expense bills" ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='small-expense-bills' AND public.is_project_sales_staff(auth.uid())
 AND public.has_permission(auth.uid(),'small_expense.create')
 AND (storage.foldername(name))[1]=(SELECT company_id::text FROM public.profiles WHERE id=auth.uid() AND is_active)
 AND (storage.foldername(name))[2]=auth.uid()::text
 AND storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png|webp)$');

-- Record actual sale terms separately from list-price and payment accounting.
ALTER TABLE public.property_sales
 ADD COLUMN IF NOT EXISTS agreed_rate_per_sqft numeric(16,2),
 ADD COLUMN IF NOT EXISTS agreed_rate_basis text,
 ADD COLUMN IF NOT EXISTS granted_amenities text,
 ADD COLUMN IF NOT EXISTS bonus_items text,
 ADD COLUMN IF NOT EXISTS referral_details text;
ALTER TABLE public.property_sale_receipts
 ADD COLUMN IF NOT EXISTS proof_path text,
 ADD COLUMN IF NOT EXISTS proof_filename text;
CREATE UNIQUE INDEX IF NOT EXISTS property_receipt_unique_proof ON public.property_sale_receipts(proof_path) WHERE proof_path IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sales_save_deal_terms(_sale_id uuid,_rate numeric,_basis text,_amenities text,_bonus text,_referral text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE sale public.property_sales%ROWTYPE;
BEGIN
 SELECT * INTO sale FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(sale.project_id) OR NOT public.actor_in_company(sale.company_id) THEN RAISE EXCEPTION 'Sale not accessible'; END IF;
 IF sale.status='cancelled' THEN RAISE EXCEPTION 'Cancelled booking'; END IF;
 IF (_rate IS NOT NULL AND (_rate<=0 OR _rate>100000000 OR round(_rate,2)<>_rate OR _basis IS NULL OR _basis NOT IN ('carpet','built_up','saleable')))
    OR (_rate IS NULL AND _basis IS NOT NULL)
    OR length(coalesce(_amenities,''))>2000 OR length(coalesce(_bonus,''))>2000 OR length(coalesce(_referral,''))>2000 THEN RAISE EXCEPTION 'Invalid rate or deal terms'; END IF;
 UPDATE public.property_sales SET agreed_rate_per_sqft=_rate,agreed_rate_basis=_basis,
 granted_amenities=nullif(btrim(coalesce(_amenities,'')),''),
 bonus_items=nullif(btrim(coalesce(_bonus,'')),''),
 referral_details=nullif(btrim(coalesce(_referral,'')),'') WHERE id=_sale_id;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id) VALUES(_sale_id,'deal_terms_updated',
 jsonb_build_object('previous_rate',sale.agreed_rate_per_sqft,'previous_basis',sale.agreed_rate_basis,'previous_amenities',sale.granted_amenities,'previous_bonus',sale.bonus_items,'previous_referral',sale.referral_details,
 'rate',_rate,'basis',_basis,'amenities',_amenities,'bonus',_bonus,'referral',_referral),auth.uid());
END $$;
CREATE OR REPLACE FUNCTION public.sales_book_flat_with_terms(_unit_id uuid,_name text,_mobile text,_price numeric,_booked_on date,_email text,_co_buyer text,_notes text,
 _rate numeric,_basis text,_amenities text,_bonus text,_referral text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE sale_id uuid;
BEGIN
 sale_id:=public.sales_book_flat(_unit_id,_name,_mobile,_price,_booked_on,_email,_co_buyer,_notes);
 PERFORM public.sales_save_deal_terms(sale_id,_rate,_basis,_amenities,_bonus,_referral);
 RETURN sale_id;
END $$;
CREATE OR REPLACE FUNCTION public.sales_report_receipt_with_proof(_sale_id uuid,_amount numeric,_paid_on date,_method text,_reference text,_payer text,_notes text,_proof_path text,_filename text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','storage','pg_temp' AS $$
DECLARE sale public.property_sales%ROWTYPE; prior public.property_sale_receipts%ROWTYPE; result uuid;
BEGIN
 SELECT * INTO sale FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(sale.project_id) OR NOT public.actor_in_company(sale.company_id) THEN RAISE EXCEPTION 'Sale not accessible'; END IF;
 IF _proof_path IS NULL OR split_part(_proof_path,'/',2)<>_sale_id::text OR NOT public.sales_doc_access(_proof_path,true)
   OR length(btrim(coalesce(_filename,''))) NOT BETWEEN 1 AND 150
   OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='sales-documents' AND o.name=_proof_path AND o.owner_id=auth.uid()::text)
 THEN RAISE EXCEPTION 'Upload your receipt proof before recording payment'; END IF;
 SELECT * INTO prior FROM public.property_sale_receipts WHERE proof_path=_proof_path;
 IF FOUND THEN
   IF prior.sale_id<>_sale_id OR prior.created_by<>auth.uid() OR prior.amount IS DISTINCT FROM _amount OR prior.paid_on IS DISTINCT FROM _paid_on OR prior.method IS DISTINCT FROM _method OR prior.reference IS DISTINCT FROM nullif(btrim(coalesce(_reference,'')),'') OR prior.payer_name IS DISTINCT FROM nullif(btrim(coalesce(_payer,'')),'') OR prior.notes IS DISTINCT FROM nullif(btrim(coalesce(_notes,'')),'') THEN RAISE EXCEPTION 'Receipt proof already used with different payment details'; END IF;
   RETURN prior.id;
 END IF;
 IF sale.status='cancelled' OR _amount IS NULL OR _amount<=0 OR _amount>sale.final_sale_price OR round(_amount,2)<>_amount OR _paid_on IS NULL OR _paid_on>(now() AT TIME ZONE 'Asia/Kolkata')::date OR _method IS NULL OR _method NOT IN ('cash','upi','neft','rtgs','imps','cheque','card','other') OR (_method<>'cash' AND length(btrim(coalesce(_reference,'')))<3) THEN RAISE EXCEPTION 'Invalid receipt amount, date or payment details'; END IF;
 IF coalesce((SELECT sum(amount) FROM public.property_sale_receipts WHERE sale_id=_sale_id AND status IN ('reported','verified')),0)+_amount>sale.final_sale_price THEN RAISE EXCEPTION 'Payment exceeds remaining amount including reported receipts'; END IF;
 IF _method<>'cash' AND EXISTS(SELECT 1 FROM public.property_sale_receipts WHERE sale_id=_sale_id AND status IN ('reported','verified') AND lower(btrim(reference))=lower(btrim(_reference))) THEN RAISE EXCEPTION 'Payment reference already recorded'; END IF;
 INSERT INTO public.property_sale_receipts(sale_id,amount,paid_on,method,reference,payer_name,notes,created_by,proof_path,proof_filename)
 VALUES(_sale_id,_amount,_paid_on,_method,nullif(btrim(coalesce(_reference,'')),''),nullif(btrim(coalesce(_payer,'')),''),nullif(btrim(coalesce(_notes,'')),''),auth.uid(),_proof_path,btrim(_filename)) RETURNING id INTO result;
 PERFORM public.sales_link_document(_sale_id,'payment_proof',_proof_path,_filename);
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id) VALUES(_sale_id,'receipt_reported',jsonb_build_object('receipt_id',result,'amount',_amount,'proof_path',_proof_path),auth.uid());
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sales_save_deal_terms(uuid,numeric,text,text,text,text), public.sales_book_flat_with_terms(uuid,text,text,numeric,date,text,text,text,numeric,text,text,text,text), public.sales_report_receipt_with_proof(uuid,numeric,date,text,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sales_save_deal_terms(uuid,numeric,text,text,text,text), public.sales_book_flat_with_terms(uuid,text,text,numeric,date,text,text,text,numeric,text,text,text,text), public.sales_report_receipt_with_proof(uuid,numeric,date,text,text,text,text,text,text) TO authenticated;

-- Keep the legacy receipt endpoint for existing Director/Super Admin callers only.
CREATE OR REPLACE FUNCTION public.sales_report_receipt(_sale_id uuid, _amount numeric, _paid_on date, _method text, _reference text DEFAULT NULL::text, _payer text DEFAULT NULL::text, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_sale public.property_sales%ROWTYPE;v_id uuid;
BEGIN
 IF public.is_project_sales_staff(auth.uid()) THEN RAISE EXCEPTION 'Payment receipt proof is required'; END IF;
 IF NOT public.sales_allowed() THEN RAISE EXCEPTION 'Sales access denied';END IF;
 SELECT * INTO v_sale FROM public.property_sales WHERE id=_sale_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sales_project_allowed(v_sale.project_id) THEN
   RAISE EXCEPTION 'Sale not accessible';END IF;
 IF v_sale.status='cancelled' THEN RAISE EXCEPTION 'Cancelled booking';END IF;
 IF _amount IS NULL OR _amount<=0 OR _amount>v_sale.final_sale_price THEN
   RAISE EXCEPTION 'Invalid receipt amount';END IF;
 IF _paid_on IS NULL OR _paid_on>current_date THEN
   RAISE EXCEPTION 'Receipt date cannot be in the future';END IF;
 IF _method NOT IN ('cash','upi','neft','rtgs','imps','cheque','card','other') THEN
   RAISE EXCEPTION 'Invalid payment method';END IF;
 IF _method<>'cash' AND length(btrim(coalesce(_reference,'')))<3 THEN
   RAISE EXCEPTION 'Payment reference is required for non-cash payments';END IF;
 INSERT INTO public.property_sale_receipts(sale_id,amount,paid_on,method,
  reference,payer_name,notes,created_by)
 VALUES(_sale_id,round(_amount,2),_paid_on,_method,
  nullif(btrim(coalesce(_reference,'')),''),
  nullif(btrim(coalesce(_payer,'')),''),
  nullif(btrim(coalesce(_notes,'')),''),auth.uid()) RETURNING id INTO v_id;
 INSERT INTO public.property_sale_events(sale_id,action,details,actor_id)
 VALUES(_sale_id,'receipt_reported',jsonb_build_object('receipt_id',v_id,
        'amount',round(_amount,2)),auth.uid());
 RETURN v_id;
END $function$;
