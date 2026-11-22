-- 0104: Site Engineers may record ONLY their own project expenses.
-- Leave finance, company, invoice, payment, and ledger permissions unchanged.
-- Existing records/events are preserved; no backfill or deletion.
INSERT INTO public.permissions(code,module,description,sort_order)
VALUES ('small_expense.create','Finance','Record small expenses for assigned projects and view only own entries',105)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.role_permissions(role,permission_code)
VALUES ('site_engineer','small_expense.create')
ON CONFLICT DO NOTHING;

-- Do NOT grant financial.view or small_expense.manage to Site Engineers.
-- Existing finance-view policies remain as-is for finance administrators.
DROP POLICY IF EXISTS "Site Engineers view own small expenses" ON public.site_small_expenses;
CREATE POLICY "Site Engineers view own small expenses"
ON public.site_small_expenses FOR SELECT TO authenticated USING (
  public.actor_in_company(company_id)
  AND public.has_role(auth.uid(),'site_engineer')
  AND public.has_permission(auth.uid(),'small_expense.create')
  AND created_by=auth.uid()
  AND project_id IS NOT NULL
  AND public.can_access_project(auth.uid(),project_id)
);

DROP POLICY IF EXISTS "Site Engineers view own expense history" ON public.site_small_expense_events;
CREATE POLICY "Site Engineers view own expense history"
ON public.site_small_expense_events FOR SELECT TO authenticated USING (
  public.actor_in_company(company_id)
  AND public.has_role(auth.uid(),'site_engineer')
  AND public.has_permission(auth.uid(),'small_expense.create')
  AND EXISTS (
    SELECT 1 FROM public.site_small_expenses e
    WHERE e.id=site_small_expense_events.expense_id
      AND e.company_id=site_small_expense_events.company_id
      AND e.created_by=auth.uid()
      AND e.project_id IS NOT NULL
      AND public.can_access_project(auth.uid(),e.project_id)
  )
);

DROP POLICY IF EXISTS "Site Engineers view own expense bills" ON public.site_small_expense_bills;
CREATE POLICY "Site Engineers view own expense bills"
ON public.site_small_expense_bills FOR SELECT TO authenticated USING (
  public.actor_in_company(company_id)
  AND public.has_role(auth.uid(),'site_engineer')
  AND public.has_permission(auth.uid(),'small_expense.create')
  AND EXISTS (
    SELECT 1 FROM public.site_small_expenses e
    WHERE e.id=site_small_expense_bills.expense_id
      AND e.company_id=site_small_expense_bills.company_id
      AND e.created_by=auth.uid()
      AND e.project_id IS NOT NULL
      AND public.can_access_project(auth.uid(),e.project_id)
  )
);

-- Storage is still private, and files must be in the uploader's own folder.
-- This is upload permission only, not blanket document read permission.
DROP POLICY IF EXISTS "Small expense bill upload" ON storage.objects;
CREATE POLICY "Small expense bill upload" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id='small-expense-bills'
  AND (storage.foldername(name))[1] = (
    SELECT p.company_id::text FROM public.profiles p
    WHERE p.id=auth.uid() AND p.is_active
  )
  AND (storage.foldername(name))[2] = auth.uid()::text
  AND storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png|webp)$'
  AND (
    (
      public.has_permission(auth.uid(),'small_expense.manage')
      AND (public.has_role(auth.uid(),'super_admin') OR
        (public.has_role(auth.uid(),'accounts_manager') AND NOT public.has_role(auth.uid(),'director')))
    )
    OR (
      public.has_permission(auth.uid(),'small_expense.create')
      AND public.has_role(auth.uid(),'site_engineer')
      AND NOT public.has_role(auth.uid(),'director')
      AND NOT public.has_role(auth.uid(),'accounts_manager')
    )
  )
);

-- Private signed-in image/document downloads check both role AND creator.
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
     AND (
       (
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

REVOKE ALL ON FUNCTION public.can_view_site_small_expense_bill(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_site_small_expense_bill(text) TO authenticated;

-- Preserve all original fiscal, idempotency, company and project validations.
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
       AND public.has_role(auth.uid(),'site_engineer')
       AND NOT public.has_role(auth.uid(),'director')
       AND NOT public.has_role(auth.uid(),'accounts_manager'))
    ) THEN
    RAISE EXCEPTION 'Only an authorized expense recorder can record small expenses';
  END IF;
  -- Field staff must always allocate expenses to a currently assigned site.
  -- They cannot create general office expenses or charge another project.
  IF public.has_role(auth.uid(),'site_engineer')
     AND NOT public.has_role(auth.uid(),'super_admin')
     AND NOT public.has_role(auth.uid(),'accounts_manager')
     AND _project_id IS NULL THEN
    RAISE EXCEPTION 'Select your assigned project for a Site Engineer expense';
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

REVOKE ALL ON FUNCTION public.record_site_small_expense(uuid,uuid,uuid,date,text,numeric,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_site_small_expense(uuid,uuid,uuid,date,text,numeric,text,text,text,text) TO authenticated;

-- Allow Site Engineers to link receipts ONLY to their own recorded expenses.
-- Existing manager permissions and all image/MIME/quantity guards are retained.
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
  site_only := public.has_role(actor,'site_engineer')
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

REVOKE ALL ON FUNCTION public.manage_site_small_expense_bill(uuid,text,text,text,bigint,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_site_small_expense_bill(uuid,text,text,text,bigint,boolean) TO authenticated;
