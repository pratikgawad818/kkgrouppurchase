-- STAGING-ONLY. 0023: controlled site / office small expenses register.
-- Requires 0020 actor_in_company. No vendor invoice, AP, cash ledger or
-- material consumption adjustments are performed here.
CREATE TABLE public.site_small_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  entry_key uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id),
  building_id uuid REFERENCES public.buildings(id),
  spent_on date NOT NULL,
  category text NOT NULL CHECK (category IN (
    'transport','tea_food','fuel','hardware','site_supplies',
    'repairs','cleaning','labour_incidental','office','other'
  )),
  amount numeric(14,2) NOT NULL CHECK (amount > 0 AND amount <= 50000),
  payment_method text NOT NULL CHECK (payment_method IN ('cash','upi','bank','card','other')),
  paid_to text NOT NULL CHECK (char_length(btrim(paid_to)) BETWEEN 2 AND 120),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 3 AND 500),
  receipt_reference text CHECK (receipt_reference IS NULL OR char_length(receipt_reference) BETWEEN 2 AND 120),
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','voided')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_by uuid REFERENCES public.profiles(id),
  voided_at timestamptz,
  void_reason text,
  UNIQUE(company_id, entry_key),
  CHECK (building_id IS NULL OR project_id IS NOT NULL),
  CHECK (
    (status='recorded' AND voided_by IS NULL AND voided_at IS NULL AND void_reason IS NULL)
    OR
    (status='voided' AND voided_by IS NOT NULL AND voided_at IS NOT NULL
      AND char_length(btrim(void_reason)) BETWEEN 5 AND 500)
  )
);
CREATE INDEX site_small_expenses_company_date_idx ON public.site_small_expenses(company_id,spent_on DESC);
CREATE INDEX site_small_expenses_project_date_idx ON public.site_small_expenses(project_id,spent_on DESC);

CREATE TABLE public.site_small_expense_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  expense_id uuid NOT NULL REFERENCES public.site_small_expenses(id),
  action text NOT NULL CHECK (action IN ('recorded','voided')),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_small_expense_events_company_idx ON public.site_small_expense_events(company_id,created_at DESC);

ALTER TABLE public.site_small_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_small_expense_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company finance sees site small expenses"
  ON public.site_small_expenses FOR SELECT TO authenticated
  USING (public.actor_in_company(company_id)
    AND public.has_permission(auth.uid(),'financial.view')
    AND (project_id IS NULL OR public.can_access_project(auth.uid(),project_id)));
CREATE POLICY "Company finance sees site expense audit"
  ON public.site_small_expense_events FOR SELECT TO authenticated
  USING (public.actor_in_company(company_id)
    AND public.has_permission(auth.uid(),'financial.view')
    AND EXISTS (
      SELECT 1 FROM public.site_small_expenses expense
      WHERE expense.id=site_small_expense_events.expense_id
        AND expense.company_id=site_small_expense_events.company_id
    ));
GRANT SELECT ON public.site_small_expenses,public.site_small_expense_events TO authenticated;
GRANT ALL ON public.site_small_expenses,public.site_small_expense_events TO service_role;

-- No direct INSERT, UPDATE or DELETE grant to authenticated.
-- The fixed RPC derives company/actor from auth.uid; never trust UI company ID.
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
  IF current_company IS NULL OR NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only an active company super administrator can record small expenses';
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

CREATE OR REPLACE FUNCTION public.void_site_small_expense(_expense_id uuid,_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE entry public.site_small_expenses%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'super_admin')
     OR char_length(btrim(coalesce(_reason,''))) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Authorized super administrator and void reason are required';
  END IF;
  SELECT * INTO entry FROM public.site_small_expenses WHERE id=_expense_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_in_company(entry.company_id) OR
     (entry.project_id IS NOT NULL AND NOT public.can_access_project(auth.uid(),entry.project_id)) THEN
    RAISE EXCEPTION 'Expense not accessible';
  END IF;
  IF entry.status='voided' THEN RETURN entry.id; END IF;
  UPDATE public.site_small_expenses SET status='voided',voided_by=auth.uid(),
    voided_at=now(),void_reason=btrim(_reason) WHERE id=_expense_id;
  INSERT INTO public.site_small_expense_events(company_id,expense_id,action,actor_id,reason)
    VALUES(entry.company_id,entry.id,'voided',auth.uid(),btrim(_reason));
  RETURN entry.id;
END
$$;
REVOKE ALL ON FUNCTION public.record_site_small_expense(
  uuid,uuid,uuid,date,text,numeric,text,text,text,text),
  public.void_site_small_expense(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_site_small_expense(
  uuid,uuid,uuid,date,text,numeric,text,text,text,text),
  public.void_site_small_expense(uuid,text) TO authenticated;
