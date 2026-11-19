-- 0077: Small Expenses: edit the same row, never void-and-replace; image/PDF bills.
-- Historical voided rows and their original audit entries remain untouched.
-- No vendor payment, journal, inventory or bank posting is generated.
ALTER TABLE public.site_small_expenses
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- A director always has read-only access. Accounts Manager may edit existing
-- records and their bills; only Super Admin may create or permanently delete.
INSERT INTO public.role_permissions(role,permission_code)
VALUES ('director','financial.view'),
       ('super_admin','small_expense.manage'),
       ('accounts_manager','small_expense.manage')
ON CONFLICT DO NOTHING;

-- Existing record RPC stays retry-safe but new entries require Super Admin.
CREATE OR REPLACE FUNCTION public.record_site_small_expense(
  _entry_key uuid, _project_id uuid, _building_id uuid, _spent_on date,
  _category text, _amount numeric, _payment_method text, _paid_to text,
  _description text, _receipt_reference text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_company uuid; inserted_id uuid; prior public.site_small_expenses%ROWTYPE;
  clean_ref text := NULLIF(btrim(coalesce(_receipt_reference,'')),'');
  clean_payee text := btrim(coalesce(_paid_to,''));
  clean_description text := btrim(coalesce(_description,''));
BEGIN
  SELECT company_id INTO current_company FROM public.profiles
    WHERE id=auth.uid() AND is_active;
  IF current_company IS NULL OR NOT public.has_role(auth.uid(),'super_admin') OR NOT public.has_permission(auth.uid(),'small_expense.manage') THEN
    RAISE EXCEPTION 'Only an active authorized finance operator can record small expenses';
  END IF;
  -- Use the business operating date in India, regardless of the
  -- connection/DB session timezone (usually UTC in cloud hosting).
  IF _entry_key IS NULL OR _spent_on IS NULL OR
    _spent_on>(now() AT TIME ZONE 'Asia/Kolkata')::date
    OR _spent_on<((now() AT TIME ZONE 'Asia/Kolkata')::date - interval '3 years')::date OR
    _category IS NULL OR _category NOT IN ('transport','tea_food','fuel','hardware','site_supplies','repairs','cleaning','labour_incidental','office','security_guard','other')
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
$$;

-- Remove legacy correction/void actions from authenticated API; old SQL
-- functions remain installed for forensic audit/older historical records.
REVOKE EXECUTE ON FUNCTION public.correct_site_small_expense(
  uuid,uuid,uuid,uuid,date,text,numeric,text,text,text,text,text
) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.correct_site_small_expense_detailed(
  uuid,uuid,uuid,uuid,date,text,numeric,text,text,text,text,text,text
) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.void_site_small_expense(uuid,text)
  FROM PUBLIC,anon,authenticated;

-- Existing immutable events are retained. Additional edit and bill events
-- append snapshots so financial reviewers can inspect what changed.
ALTER TABLE public.site_small_expense_events
  DROP CONSTRAINT IF EXISTS site_small_expense_events_action_check;
ALTER TABLE public.site_small_expense_events
  ADD CONSTRAINT site_small_expense_events_action_check
  CHECK (action IN ('recorded','voided','edited','bill_added','bill_removed'));
ALTER TABLE public.site_small_expense_events
  ADD COLUMN IF NOT EXISTS before_values jsonb,
  ADD COLUMN IF NOT EXISTS after_values jsonb;

CREATE OR REPLACE FUNCTION public.edit_site_small_expense(
  _expense_id uuid, _expected_updated_at timestamptz,
  _payload jsonb, _reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor uuid := auth.uid();
  company uuid;
  previous public.site_small_expenses%ROWTYPE;
  revised public.site_small_expenses%ROWTYPE;
  chosen_project uuid;
  chosen_building uuid;
  chosen_date date;
  chosen_category text;
  chosen_amount numeric;
  chosen_method text;
  chosen_payee text;
  chosen_description text;
  chosen_reference text;
  chosen_other text;
  reason_text text := nullif(btrim(coalesce(_reason,'')),'');
BEGIN
  SELECT p.company_id INTO company FROM public.profiles p
    WHERE p.id=actor AND p.is_active;
  IF actor IS NULL OR company IS NULL
    OR NOT public.has_permission(actor,'small_expense.manage')
    OR NOT (
      public.has_role(actor,'super_admin') OR
      (public.has_role(actor,'accounts_manager') AND NOT public.has_role(actor,'director'))
    ) THEN RAISE EXCEPTION 'Only Super Admin or Accounts Manager can edit small expenses'; END IF;
  IF _expense_id IS NULL OR _expected_updated_at IS NULL
    OR jsonb_typeof(_payload) IS DISTINCT FROM 'object'
    OR (reason_text IS NOT NULL AND char_length(reason_text)>400) THEN
    RAISE EXCEPTION 'Invalid expense edit; reload and try again'; END IF;

  SELECT * INTO previous FROM public.site_small_expenses
    WHERE id=_expense_id FOR UPDATE;
  IF NOT FOUND OR previous.company_id IS DISTINCT FROM company
    OR previous.status <> 'recorded'
    OR (previous.project_id IS NOT NULL AND NOT public.can_access_project(actor,previous.project_id)) THEN
    RAISE EXCEPTION 'This expense is not editable'; END IF;
  IF previous.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Expense was changed by someone else. Reload before editing'; END IF;

  chosen_project := nullif(_payload->>'project_id','')::uuid;
  chosen_building := nullif(_payload->>'building_id','')::uuid;
  chosen_date := nullif(_payload->>'spent_on','')::date;
  chosen_category := _payload->>'category';
  chosen_amount := nullif(_payload->>'amount','')::numeric;
  chosen_method := _payload->>'payment_method';
  chosen_payee := btrim(coalesce(_payload->>'paid_to',''));
  chosen_description := btrim(coalesce(_payload->>'description',''));
  chosen_reference := nullif(btrim(coalesce(_payload->>'receipt_reference','')),'');
  chosen_other := nullif(btrim(coalesce(_payload->>'other_category_detail','')),'');

  IF chosen_date IS NULL OR chosen_date>(now() AT TIME ZONE 'Asia/Kolkata')::date
    OR chosen_date<((now() AT TIME ZONE 'Asia/Kolkata')::date - interval '3 years')::date
    OR chosen_category IS NULL OR chosen_category NOT IN (
      'transport','tea_food','fuel','hardware','site_supplies','repairs',
      'cleaning','labour_incidental','office','security_guard','other')
    OR chosen_amount IS NULL OR chosen_amount <= 0 OR chosen_amount::text IN ('NaN','Infinity','-Infinity')
    OR chosen_amount > 999999999999.99 OR round(chosen_amount,2) <> chosen_amount
    OR chosen_method IS NULL OR chosen_method NOT IN ('cash','upi','bank','card','other')
    OR char_length(chosen_payee) NOT BETWEEN 2 AND 120
    OR char_length(chosen_description) NOT BETWEEN 3 AND 500
    OR (chosen_reference IS NOT NULL AND char_length(chosen_reference) NOT BETWEEN 2 AND 120)
    OR (chosen_other IS NOT NULL AND
        (chosen_category <> 'other' OR char_length(chosen_other) NOT BETWEEN 2 AND 120))
  THEN RAISE EXCEPTION 'Invalid expense details, date, category, amount or receipt'; END IF;
  IF chosen_building IS NOT NULL AND chosen_project IS NULL THEN
    RAISE EXCEPTION 'Select the project before selecting the building'; END IF;
  IF chosen_project IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id=chosen_project
      AND p.company_id=company AND public.can_access_project(actor,p.id)
  ) THEN RAISE EXCEPTION 'Project does not belong to your accessible company'; END IF;
  IF chosen_building IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.buildings b WHERE b.id=chosen_building
      AND b.project_id=chosen_project
  ) THEN RAISE EXCEPTION 'Building does not belong to this project'; END IF;

  UPDATE public.site_small_expenses SET
    project_id=chosen_project,building_id=chosen_building,spent_on=chosen_date,
    category=chosen_category,amount=chosen_amount,payment_method=chosen_method,
    paid_to=chosen_payee,description=chosen_description,
    receipt_reference=chosen_reference,other_category_detail=chosen_other,
    updated_at=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond')
    WHERE id=_expense_id RETURNING * INTO revised;

  IF (to_jsonb(previous) - 'updated_at') IS DISTINCT FROM
     (to_jsonb(revised) - 'updated_at') THEN
    INSERT INTO public.site_small_expense_events
      (company_id,expense_id,action,actor_id,reason,before_values,after_values)
    VALUES(company,_expense_id,'edited',actor,
      coalesce(reason_text,'Expense details updated'),to_jsonb(previous),to_jsonb(revised));
  END IF;
  RETURN _expense_id;
END $$;
REVOKE ALL ON FUNCTION public.edit_site_small_expense(uuid,timestamptz,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.edit_site_small_expense(uuid,timestamptz,jsonb,text) TO authenticated;

-- Private storage: company / uploader / UUID.extension. No public bucket URLs.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('small-expense-bills','small-expense-bills',false,10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=10485760,
 allowed_mime_types=excluded.allowed_mime_types;

CREATE TABLE public.site_small_expense_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  expense_id uuid NOT NULL REFERENCES public.site_small_expenses(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_by uuid REFERENCES public.profiles(id),
  removed_at timestamptz,
  CHECK ((is_active AND removed_by IS NULL AND removed_at IS NULL)
    OR (NOT is_active AND removed_by IS NOT NULL AND removed_at IS NOT NULL))
);
CREATE INDEX site_small_expense_bills_expense_active_idx
  ON public.site_small_expense_bills(expense_id,is_active,created_at);
ALTER TABLE public.site_small_expense_bills ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_small_expense_bills FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.site_small_expense_bills TO authenticated;
GRANT ALL ON public.site_small_expense_bills TO service_role;
CREATE POLICY "Company financial viewers read small expense bills"
ON public.site_small_expense_bills FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.site_small_expenses e
    WHERE e.id=site_small_expense_bills.expense_id
      AND e.company_id=site_small_expense_bills.company_id
      AND public.actor_in_company(e.company_id)
      AND public.has_permission(auth.uid(),'financial.view')
      AND (e.project_id IS NULL OR public.can_access_project(auth.uid(),e.project_id))
  )
);

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
  AND public.has_permission(auth.uid(),'small_expense.manage')
  AND (
    public.has_role(auth.uid(),'super_admin')
    OR (public.has_role(auth.uid(),'accounts_manager') AND NOT public.has_role(auth.uid(),'director'))
  )
);

CREATE OR REPLACE FUNCTION public.can_view_site_small_expense_bill(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.site_small_expense_bills b
   JOIN public.site_small_expenses e ON e.id=b.expense_id
   WHERE b.storage_path=_path AND b.is_active
     AND b.company_id=e.company_id
     AND public.actor_in_company(e.company_id)
     AND public.has_permission(auth.uid(),'financial.view')
     AND (e.project_id IS NULL OR public.can_access_project(auth.uid(),e.project_id))
 );
$$;
REVOKE ALL ON FUNCTION public.can_view_site_small_expense_bill(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_site_small_expense_bill(text) TO authenticated;

DROP POLICY IF EXISTS "Small expense bill view" ON storage.objects;
CREATE POLICY "Small expense bill view" ON storage.objects FOR SELECT
TO authenticated USING (
  bucket_id='small-expense-bills'
  AND (
    -- Own staged uploads may be inspected before linking.
    ((storage.foldername(name))[2]=auth.uid()::text
      AND (storage.foldername(name))[1]=(
        SELECT p.company_id::text FROM public.profiles p
        WHERE p.id=auth.uid() AND p.is_active
      ))
    OR public.can_view_site_small_expense_bill(name)
  )
);

CREATE OR REPLACE FUNCTION public.manage_site_small_expense_bill(
  _expense_id uuid, _path text, _file_name text DEFAULT NULL,
  _mime_type text DEFAULT NULL, _bytes bigint DEFAULT NULL, _remove boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid := auth.uid(); current_company uuid;
        expense public.site_small_expenses%ROWTYPE; bill public.site_small_expense_bills%ROWTYPE;
        result_id uuid; object_mime text; object_bytes bigint;
BEGIN
  SELECT company_id INTO current_company FROM public.profiles
    WHERE id=actor AND is_active;
  IF current_company IS NULL
    OR NOT public.has_permission(actor,'small_expense.manage')
    OR NOT (public.has_role(actor,'super_admin') OR
      (public.has_role(actor,'accounts_manager') AND NOT public.has_role(actor,'director'))) THEN
    RAISE EXCEPTION 'Only Super Admin or Accounts Manager may manage expense bills'; END IF;
  SELECT * INTO expense FROM public.site_small_expenses WHERE id=_expense_id FOR UPDATE;
  IF NOT FOUND OR expense.company_id<>current_company OR expense.status<>'recorded'
    OR (expense.project_id IS NOT NULL AND NOT public.can_access_project(actor,expense.project_id)) THEN
    RAISE EXCEPTION 'Expense is not accessible for bill changes'; END IF;

  IF _remove THEN
    SELECT * INTO bill FROM public.site_small_expense_bills
      WHERE storage_path=_path AND expense_id=_expense_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bill does not belong to this expense'; END IF;
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
END $$;
REVOKE ALL ON FUNCTION public.manage_site_small_expense_bill(uuid,text,text,text,bigint,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_site_small_expense_bill(uuid,text,text,text,bigint,boolean) TO authenticated;
