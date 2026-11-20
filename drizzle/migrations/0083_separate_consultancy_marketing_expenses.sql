-- 0083: Separate Consultancy and Marketing into two independent Small Expenses categories.
-- Preserve role controls, approvals, entry-key idempotency, audit history,
-- existing row data, and original payment/stock behavior.
-- These categories are for actually PAID independent consultancy or marketing expenses.
-- Do not re-enter a supplier invoice or PO payment already recorded elsewhere.

-- Old combined category must never be silently reclassified as either expense.
-- On 20 Nov 2026 it had zero records. Fail explicitly if one was added
-- between that check and migration instead of changing historical amounts.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.site_small_expenses
             WHERE category='consultancy_marketing') THEN
    RAISE EXCEPTION 'Legacy Consultancy and Marketing expenses exist; manually reclassify them before migration 0083';
  END IF;
END $guard$;

-- Database constraint, recorder and editor must accept the same two categories.
ALTER TABLE public.site_small_expenses
  DROP CONSTRAINT IF EXISTS site_small_expenses_category_check;

ALTER TABLE public.site_small_expenses
  ADD CONSTRAINT site_small_expenses_category_check CHECK (
    category IN (
      'transport','tea_food','fuel','hardware','site_supplies','repairs',
      'cleaning','labour_incidental','office','security_guard',
      'consultancy','marketing','other'
    )
  );

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
  IF current_company IS NULL OR NOT public.has_permission(auth.uid(),'small_expense.manage')
    OR NOT (
      public.has_role(auth.uid(),'super_admin')
      OR (public.has_role(auth.uid(),'accounts_manager') AND NOT public.has_role(auth.uid(),'director'))
    ) THEN
    RAISE EXCEPTION 'Only an active authorized finance operator can record small expenses';
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
$$;


-- Explicitly keep the procedure callable by authenticated staff; the
-- SECURITY DEFINER body enforces company, role, project and input checks.

-- Preserve strict permission checks and existing authenticated execution.
REVOKE ALL ON FUNCTION public.record_site_small_expense(
  uuid,uuid,uuid,date,text,numeric,text,text,text,text
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_site_small_expense(
  uuid,uuid,uuid,date,text,numeric,text,text,text,text
) TO authenticated;

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
      'cleaning','labour_incidental','office','security_guard','consultancy','marketing','other')
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

REVOKE ALL ON FUNCTION public.edit_site_small_expense(
  uuid,timestamptz,jsonb,text
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.edit_site_small_expense(
  uuid,timestamptz,jsonb,text
) TO authenticated;
