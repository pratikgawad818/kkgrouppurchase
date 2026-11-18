-- 0069: Accounts Manager can record and correct small expenses without deletion rights.
-- Corrections preserve original records, a replacement link, and audit events.
-- Direct writes to either table remain prohibited for authenticated users.
INSERT INTO public.permissions (code,module,description,sort_order)
VALUES ('small_expense.manage','Finance',
  'Record and correct audited small expenses without permanent deletion',104)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role,permission_code)
VALUES ('super_admin','small_expense.manage'),
       ('accounts_manager','small_expense.manage')
ON CONFLICT DO NOTHING;

ALTER TABLE public.site_small_expenses
  ADD COLUMN replaces_expense_id uuid REFERENCES public.site_small_expenses(id);
CREATE UNIQUE INDEX site_small_expenses_one_replacement_idx
  ON public.site_small_expenses (replaces_expense_id)
  WHERE replaces_expense_id IS NOT NULL;

-- Retain all validations, date boundaries, company/project scoping and retry guards.
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
  IF current_company IS NULL OR NOT public.has_permission(auth.uid(),'small_expense.manage') THEN
    RAISE EXCEPTION 'Only an active authorized finance operator can record small expenses';
  END IF;
  -- Use the business operating date in India, regardless of the
  -- connection/DB session timezone (usually UTC in cloud hosting).
  IF _entry_key IS NULL OR _spent_on IS NULL OR
    _spent_on>(now() AT TIME ZONE 'Asia/Kolkata')::date
    OR _spent_on<((now() AT TIME ZONE 'Asia/Kolkata')::date - interval '3 years')::date OR
    _category IS NULL OR _category NOT IN ('transport','tea_food','fuel','hardware','site_supplies','repairs','cleaning','labour_incidental','office','other')
    OR _amount IS NULL OR _amount <= 0 OR _amount > 50000 OR round(_amount,2)<>_amount
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

-- The correction is a single database transaction: if any step fails,
-- neither the original void nor the replacement record can be committed.
CREATE OR REPLACE FUNCTION public.correct_site_small_expense(
  _expense_id uuid, _entry_key uuid, _project_id uuid, _building_id uuid,
  _spent_on date, _category text, _amount numeric, _payment_method text,
  _paid_to text, _description text, _receipt_reference text, _reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  original public.site_small_expenses%ROWTYPE;
  company uuid;
  replacement_id uuid;
  correction_reason text := btrim(coalesce(_reason,''));
BEGIN
  SELECT p.company_id INTO company
  FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active;
  IF company IS NULL OR NOT public.has_permission(auth.uid(),'small_expense.manage') THEN
    RAISE EXCEPTION 'Not authorized to correct small expenses';
  END IF;
  IF _expense_id IS NULL OR _entry_key IS NULL
     OR char_length(correction_reason) NOT BETWEEN 10 AND 400 THEN
    RAISE EXCEPTION 'A correction reason of 10 to 400 characters is required';
  END IF;

  SELECT * INTO original FROM public.site_small_expenses
    WHERE id=_expense_id FOR UPDATE;
  IF NOT FOUND OR original.company_id<>company
     OR (original.project_id IS NOT NULL AND NOT public.can_access_project(auth.uid(),original.project_id)) THEN
    RAISE EXCEPTION 'Expense not accessible for correction';
  END IF;

  IF original.status='voided' THEN
    -- Exact retry after a successful correction must not create a second bill.
    SELECT e.id INTO replacement_id
    FROM public.site_small_expenses e
    WHERE e.replaces_expense_id=original.id
      AND e.company_id=company
      AND e.entry_key=_entry_key
      AND e.created_by=auth.uid();
    IF replacement_id IS NULL THEN
      RAISE EXCEPTION 'This expense has already been voided or corrected';
    END IF;
    IF original.void_reason IS DISTINCT FROM ('Corrected: ' || correction_reason) THEN
      RAISE EXCEPTION 'This expense was corrected with a different reason';
    END IF;
    IF public.record_site_small_expense(
      _entry_key,_project_id,_building_id,_spent_on,
      _category,_amount,_payment_method,_paid_to,_description,_receipt_reference
    ) IS DISTINCT FROM replacement_id THEN
      RAISE EXCEPTION 'Correction retry does not match the original replacement';
    END IF;
    RETURN replacement_id;
  END IF;

  -- Reserve a fresh idempotency key; never adopt a prior standalone entry.
  IF EXISTS (
    SELECT 1 FROM public.site_small_expenses
    WHERE company_id=company AND entry_key=_entry_key
  ) THEN
    RAISE EXCEPTION 'This correction key has already been used';
  END IF;

  replacement_id := public.record_site_small_expense(
    _entry_key,_project_id,_building_id,_spent_on,
    _category,_amount,_payment_method,_paid_to,_description,_receipt_reference
  );
  UPDATE public.site_small_expenses
     SET replaces_expense_id=original.id
   WHERE id=replacement_id;

  UPDATE public.site_small_expenses
     SET status='voided',voided_by=auth.uid(),voided_at=now(),
         void_reason='Corrected: ' || correction_reason
   WHERE id=original.id;

  INSERT INTO public.site_small_expense_events (
    company_id,expense_id,action,actor_id,reason
  ) VALUES (
    company,original.id,'voided',auth.uid(),'Corrected: ' || correction_reason
  );
  RETURN replacement_id;
END
$$;

REVOKE ALL ON FUNCTION public.correct_site_small_expense(
  uuid,uuid,uuid,uuid,date,text,numeric,text,text,text,text,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.correct_site_small_expense(
  uuid,uuid,uuid,uuid,date,text,numeric,text,text,text,text,text)
  TO authenticated;
