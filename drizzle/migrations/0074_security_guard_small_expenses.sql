-- New standalone small-expense classification for outsourced / site security.
-- No old expense, payment, stock, or accounting rows are modified.
ALTER TABLE public.site_small_expenses
  DROP CONSTRAINT IF EXISTS site_small_expenses_category_check;
ALTER TABLE public.site_small_expenses
  ADD CONSTRAINT site_small_expenses_category_check
  CHECK (category IN (
    'transport','tea_food','fuel','hardware','site_supplies','repairs',
    'cleaning','labour_incidental','office','security_guard','other'
  ));

-- Preserve existing role checks, project scoping, INR limits, correction
-- idempotency and audit logic; extend only the allowed category list.
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
    _category IS NULL OR _category NOT IN ('transport','tea_food','fuel','hardware','site_supplies','repairs','cleaning','labour_incidental','office','security_guard','other')
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


-- "Other" is a catch-all accounting classification, but staff may optionally
-- describe the actual cost type. Keep that label separately from the payment
-- purpose, so reporting and audited corrections do not corrupt either field.
ALTER TABLE public.site_small_expenses
  ADD COLUMN IF NOT EXISTS other_category_detail text;

ALTER TABLE public.site_small_expenses
  ADD CONSTRAINT site_small_expenses_other_category_detail_check
  CHECK (
    other_category_detail IS NULL
    OR (
      category = 'other'
      AND char_length(other_category_detail) BETWEEN 2 AND 120
      AND other_category_detail = btrim(other_category_detail)
    )
  );

-- The existing record/correct RPC signatures remain callable, so older
-- clients and historical entries are unaffected by the additional field.
-- New forms use the _detailed variants to save the optional label atomically.
CREATE OR REPLACE FUNCTION public.record_site_small_expense_detailed(
  _entry_key uuid, _project_id uuid, _building_id uuid, _spent_on date,
  _category text, _amount numeric, _payment_method text, _paid_to text,
  _description text, _receipt_reference text, _other_category_detail text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  company uuid;
  clean_detail text := nullif(btrim(coalesce(_other_category_detail,'')),'');
  prior_detail text;
  already_saved boolean;
  saved_id uuid;
BEGIN
  IF _entry_key IS NULL THEN RAISE EXCEPTION 'Expense entry key is required'; END IF;
  IF clean_detail IS NOT NULL AND (
    char_length(clean_detail) NOT BETWEEN 2 AND 120
    OR _category IS DISTINCT FROM 'other'
  ) THEN
    RAISE EXCEPTION 'Other category description must be 2 to 120 characters and category must be Other';
  END IF;
  SELECT company_id INTO company
  FROM public.profiles WHERE id=auth.uid() AND is_active;
  IF company IS NULL THEN RAISE EXCEPTION 'Active company is required'; END IF;

  -- Serialize same-key retries before reading to prevent changing metadata
  -- of an existing recorded expense even during simultaneous submissions.
  PERFORM pg_advisory_xact_lock(hashtextextended(_entry_key::text, 74));
  SELECT other_category_detail INTO prior_detail
  FROM public.site_small_expenses
  WHERE company_id=company AND entry_key=_entry_key FOR UPDATE;
  already_saved := FOUND;
  IF already_saved AND prior_detail IS DISTINCT FROM clean_detail THEN
    RAISE EXCEPTION 'Other category description differs from saved expense';
  END IF;

  -- Existing function remains the authority for permissions, amounts,
  -- dates, project scope, duplicate keys, audit events and entry status.
  saved_id := public.record_site_small_expense(
    _entry_key,_project_id,_building_id,_spent_on,
    _category,_amount,_payment_method,_paid_to,_description,_receipt_reference
  );
  IF NOT already_saved AND clean_detail IS NOT NULL THEN
    UPDATE public.site_small_expenses
    SET other_category_detail=clean_detail WHERE id=saved_id;
  END IF;
  RETURN saved_id;
END $$;

REVOKE ALL ON FUNCTION public.record_site_small_expense_detailed(
  uuid,uuid,uuid,date,text,numeric,text,text,text,text,text
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_site_small_expense_detailed(
  uuid,uuid,uuid,date,text,numeric,text,text,text,text,text
) TO authenticated;

-- Correction is still a single database transaction: a replacement is
-- created and the original voided, with its original category detail intact.
CREATE OR REPLACE FUNCTION public.correct_site_small_expense_detailed(
  _expense_id uuid, _entry_key uuid, _project_id uuid, _building_id uuid,
  _spent_on date, _category text, _amount numeric, _payment_method text,
  _paid_to text, _description text, _receipt_reference text, _reason text,
  _other_category_detail text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  company uuid;
  clean_detail text := nullif(btrim(coalesce(_other_category_detail,'')),'');
  prior_detail text;
  already_saved boolean;
  replacement_id uuid;
BEGIN
  IF _entry_key IS NULL THEN RAISE EXCEPTION 'Correction entry key is required'; END IF;
  IF clean_detail IS NOT NULL AND (
    char_length(clean_detail) NOT BETWEEN 2 AND 120
    OR _category IS DISTINCT FROM 'other'
  ) THEN
    RAISE EXCEPTION 'Other category description must be 2 to 120 characters and category must be Other';
  END IF;
  SELECT company_id INTO company
  FROM public.profiles WHERE id=auth.uid() AND is_active;
  IF company IS NULL THEN RAISE EXCEPTION 'Active company is required'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_entry_key::text, 74));
  SELECT other_category_detail INTO prior_detail
  FROM public.site_small_expenses
  WHERE company_id=company AND entry_key=_entry_key FOR UPDATE;
  already_saved := FOUND;
  IF already_saved AND prior_detail IS DISTINCT FROM clean_detail THEN
    RAISE EXCEPTION 'Other category description differs from saved correction';
  END IF;

  replacement_id := public.correct_site_small_expense(
    _expense_id,_entry_key,_project_id,_building_id,_spent_on,
    _category,_amount,_payment_method,_paid_to,_description,
    _receipt_reference,_reason
  );
  IF NOT already_saved AND clean_detail IS NOT NULL THEN
    UPDATE public.site_small_expenses
    SET other_category_detail=clean_detail WHERE id=replacement_id;
  END IF;
  RETURN replacement_id;
END $$;

REVOKE ALL ON FUNCTION public.correct_site_small_expense_detailed(
  uuid,uuid,uuid,uuid,date,text,numeric,text,text,text,text,text,text
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.correct_site_small_expense_detailed(
  uuid,uuid,uuid,uuid,date,text,numeric,text,text,text,text,text,text
) TO authenticated;
