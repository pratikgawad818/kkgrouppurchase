-- Reviewed append-only correction of a missed historical settlement.
-- No cash/bank transaction is created; new payments use the ordinary workflow.
CREATE TABLE public.opening_payment_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.vendor_invoices(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
  payment_date date NOT NULL,
  payment_mode text NOT NULL CHECK (payment_mode IN ('neft','rtgs','imps','cheque','upi','cash','card','other')),
  reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 3 AND 150),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  expected_invoice_updated_at timestamptz NOT NULL,
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  posting_date date,
  prior_payment_id uuid UNIQUE REFERENCES public.opening_vendor_invoice_prior_payments(id) ON DELETE RESTRICT,
  journal_entry_id uuid UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  CHECK (reviewed_by IS DISTINCT FROM requested_by),
  CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL AND posting_date IS NULL AND prior_payment_id IS NULL AND journal_entry_id IS NULL)
      OR (status='rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL AND posting_date IS NULL AND prior_payment_id IS NULL AND journal_entry_id IS NULL)
      OR (status='approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL AND posting_date IS NOT NULL AND prior_payment_id IS NOT NULL AND journal_entry_id IS NOT NULL))
);
CREATE UNIQUE INDEX opening_payment_one_pending_per_bill
  ON public.opening_payment_amendments(invoice_id) WHERE status='pending';
CREATE UNIQUE INDEX opening_payment_unique_reference
  ON public.opening_payment_amendments(company_id,vendor_id,lower(regexp_replace(reference,'[[:space:]]+','','g')))
  WHERE status IN ('pending','approved');
ALTER TABLE public.opening_payment_amendments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.opening_payment_amendments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.opening_payment_amendments TO authenticated;
CREATE POLICY "Opening payment amendments visible" ON public.opening_payment_amendments
FOR SELECT TO authenticated USING (public.actor_in_company(company_id) AND public.vi_can_view(invoice_id));
CREATE TRIGGER audit_opening_payment_amendments AFTER INSERT OR UPDATE OR DELETE
ON public.opening_payment_amendments FOR EACH ROW EXECUTE FUNCTION public.audit_row();

ALTER TABLE public.journal_entries DROP CONSTRAINT journal_entries_source_type_check;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_source_type_check
CHECK (source_type IN ('vendor_invoice','vendor_payment','advance_adjustment','opening_payment_correction'));

-- Internal guard; invoice is locked before this check by both public RPCs.
CREATE FUNCTION public.check_opening_payment_amendment(
  _inv public.vendor_invoices, _amount numeric, _date date, _reference text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
DECLARE
  recorded numeric; historical numeric; adjusted numeric; original_credit numeric;
  original_entries integer; previous_corrections numeric; ref text;
BEGIN
  IF NOT _inv.is_opening OR _inv.status NOT IN ('approved','partially_paid') THEN
    RAISE EXCEPTION 'Only approved old bills with an unpaid balance are eligible';
  END IF;
  IF _amount IS NULL OR _amount::text IN ('NaN','Infinity','-Infinity')
     OR _amount<=0 OR _amount>1000000000 OR _amount<>round(_amount,2) THEN
    RAISE EXCEPTION 'Enter a positive amount with at most two decimals';
  END IF;
  IF _date IS NULL OR _date<_inv.vendor_invoice_date
     OR _date>(_inv.created_at AT TIME ZONE 'Asia/Kolkata')::date
     OR _date>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Historical payment must be between bill date and original ERP entry date';
  END IF;
  IF length(btrim(coalesce(_reference,''))) NOT BETWEEN 3 AND 150 THEN
    RAISE EXCEPTION 'Enter the original bank, cheque or cash voucher reference';
  END IF;
  -- Aggregate-only legacy payments cannot be reliably matched against proof.
  IF _inv.opening_legacy_paid<>0 THEN
    RAISE EXCEPTION 'Aggregate historical payment already exists; reconcile it separately before adding omitted payments';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vendor_payment_allocations a JOIN public.vendor_payments p ON p.id=a.payment_id
             WHERE a.invoice_id=_inv.id AND p.status IN ('scheduled','approved')) THEN
    RAISE EXCEPTION 'Resolve pending or approved payment requests before correcting this bill';
  END IF;
  ref:=lower(regexp_replace(btrim(_reference),'[[:space:]]+','','g'));
  IF EXISTS (SELECT 1 FROM public.opening_vendor_invoice_prior_payments p
             JOIN public.vendor_invoices i ON i.id=p.invoice_id
             WHERE i.company_id=_inv.company_id AND i.vendor_id=_inv.vendor_id
               AND i.status NOT IN ('cancelled','rejected')
               AND lower(regexp_replace(coalesce(p.reference,''),'[[:space:]]+','','g'))=ref)
     OR EXISTS (SELECT 1 FROM public.vendor_payments p
             WHERE p.company_id=_inv.company_id AND p.vendor_id=_inv.vendor_id
               AND p.status<>'cancelled'
               AND lower(regexp_replace(coalesce(p.reference,''),'[[:space:]]+','','g'))=ref) THEN
    RAISE EXCEPTION 'This payment reference already exists for the supplier; reconcile before continuing';
  END IF;
  SELECT coalesce(sum(a.amount),0) INTO recorded FROM public.vendor_payment_allocations a
    JOIN public.vendor_payments p ON p.id=a.payment_id WHERE a.invoice_id=_inv.id AND p.status='recorded';
  SELECT coalesce(sum(amount),0) INTO historical FROM public.opening_vendor_invoice_prior_payments WHERE invoice_id=_inv.id;
  SELECT coalesce(sum(amount),0) INTO adjusted FROM public.vendor_advance_adjustments WHERE invoice_id=_inv.id;
  IF _inv.balance_due<>round(_inv.net_payable-recorded-historical-adjusted,2)
    OR _amount>_inv.balance_due THEN
    RAISE EXCEPTION 'Invoice balance is inconsistent or correction exceeds outstanding amount';
  END IF;
  SELECT coalesce(sum(amount),0) INTO previous_corrections FROM public.opening_payment_amendments
    WHERE invoice_id=_inv.id AND status='approved';
  SELECT count(DISTINCT j.id), coalesce(sum(l.credit) FILTER (WHERE a.code='2100'),0)
    INTO original_entries,original_credit
  FROM public.journal_entries j JOIN public.journal_lines l ON l.entry_id=j.id
    JOIN public.accounts a ON a.id=l.account_id
  WHERE j.company_id=_inv.company_id AND j.source_type='vendor_invoice' AND j.source_id=_inv.id;
  IF original_entries<>1 OR original_credit<>_inv.net_payable-historical+previous_corrections THEN
    RAISE EXCEPTION 'Original opening journal does not reconcile; review with Accounts before correcting';
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.check_opening_payment_amendment(public.vendor_invoices,numeric,date,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.request_opening_payment_amendment(
  _invoice_id uuid, _expected_updated_at timestamptz, _amount numeric, _payment_date date,
  _payment_mode text, _reference text, _reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
DECLARE inv public.vendor_invoices%ROWTYPE; result uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(),'vendor_invoice.create')
    OR NOT (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'accounts_manager'))
  THEN RAISE EXCEPTION 'Only Super Admin or Accounts Manager can request historical corrections'; END IF;
  SELECT * INTO inv FROM public.vendor_invoices WHERE id=_invoice_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_in_company(inv.company_id)
    OR NOT public.can_access_project(auth.uid(),inv.project_id)
  THEN RAISE EXCEPTION 'Invoice not accessible'; END IF;
  IF inv.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Invoice changed; refresh before requesting correction';
  END IF;
  IF _payment_mode IS NULL OR _payment_mode NOT IN ('neft','rtgs','imps','cheque','upi','cash','card','other')
    OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'Enter payment method and a reason of 10 to 500 characters'; END IF;
  PERFORM public.check_opening_payment_amendment(inv,_amount,_payment_date,_reference);
  INSERT INTO public.opening_payment_amendments(invoice_id,company_id,vendor_id,amount,payment_date,payment_mode,reference,reason,expected_invoice_updated_at,requested_by)
    VALUES(inv.id,inv.company_id,inv.vendor_id,_amount,_payment_date,_payment_mode,btrim(_reference),btrim(_reason),inv.updated_at,auth.uid())
    RETURNING id INTO result;
  RETURN result;
END $function$;

CREATE FUNCTION public.review_opening_payment_amendment(_id uuid, _decision text, _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
DECLARE
  req public.opening_payment_amendments%ROWTYPE; inv public.vendor_invoices%ROWTYPE;
  posted_on date:=(now() AT TIME ZONE 'Asia/Kolkata')::date;
  pay_id uuid; journal_id uuid; next_line integer; final_status public.invoice_status;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(),'vendor_invoice.approve')
    OR NOT (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'accounts_manager'))
  THEN RAISE EXCEPTION 'Only Super Admin or Accounts Manager can review historical corrections'; END IF;
  IF _decision IS NULL OR _decision NOT IN ('approve','reject')
    OR length(btrim(coalesce(_note,''))) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'Enter a review decision and reason of 10 to 500 characters'; END IF;
  SELECT * INTO req FROM public.opening_payment_amendments WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_in_company(req.company_id) THEN RAISE EXCEPTION 'Correction not accessible'; END IF;
  SELECT * INTO inv FROM public.vendor_invoices WHERE id=req.invoice_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_in_company(inv.company_id) OR inv.company_id<>req.company_id
    OR inv.vendor_id<>req.vendor_id OR NOT public.can_access_project(auth.uid(),inv.project_id)
  THEN RAISE EXCEPTION 'Invoice not accessible'; END IF;
  IF req.status<>'pending' THEN RAISE EXCEPTION 'Correction already reviewed'; END IF;
  IF req.requested_by=auth.uid() THEN RAISE EXCEPTION 'You cannot review your own correction'; END IF;
  IF _decision='reject' THEN
    UPDATE public.opening_payment_amendments SET status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(_note) WHERE id=req.id;
    RETURN req.id;
  END IF;
  IF inv.updated_at IS DISTINCT FROM req.expected_invoice_updated_at THEN
    RAISE EXCEPTION 'Invoice changed since request; reject and submit a new correction';
  END IF;
  PERFORM public.check_opening_payment_amendment(inv,req.amount,req.payment_date,req.reference);
  IF NOT EXISTS(SELECT 1 FROM public.financial_periods WHERE company_id=inv.company_id
     AND posted_on BETWEEN start_date AND end_date AND NOT is_closed)
     OR EXISTS(SELECT 1 FROM public.financial_periods WHERE company_id=inv.company_id
     AND posted_on BETWEEN start_date AND end_date AND is_closed) THEN
    RAISE EXCEPTION 'No open accounting period for today; correction cannot be posted';
  END IF;
  SELECT coalesce(max(line_no),0)+1 INTO next_line FROM public.opening_vendor_invoice_prior_payments WHERE invoice_id=inv.id;
  IF next_line>100 THEN RAISE EXCEPTION 'Historical payment line limit reached'; END IF;
  INSERT INTO public.opening_vendor_invoice_prior_payments(invoice_id,line_no,payment_date,payment_mode,reference,amount,remarks)
    VALUES(inv.id,next_line,req.payment_date,req.payment_mode,req.reference,req.amount,'Reviewed historical correction: '||req.reason)
    RETURNING id INTO pay_id;
  -- Current-period correction: debit trade payables, credit opening clearing.
  -- No 1100 cash/bank entry or vendor payment is made.
  journal_id:=public.post_journal(inv.company_id,posted_on,'opening_payment_correction',req.id,inv.vendor_id,inv.project_id,
    'Historical settlement correction for '||inv.invoice_number,
    jsonb_build_array(jsonb_build_object('code','2100','debit',req.amount),
                      jsonb_build_object('code','3000','credit',req.amount)));
  PERFORM public.vi_refresh_balance(inv.id);
  SELECT status INTO final_status FROM public.vendor_invoices WHERE id=inv.id;
  UPDATE public.opening_payment_amendments SET status='approved',reviewed_by=auth.uid(),reviewed_at=now(),
    review_note=btrim(_note),posting_date=posted_on,prior_payment_id=pay_id,journal_entry_id=journal_id WHERE id=req.id;
  INSERT INTO public.vendor_invoice_events(invoice_id,action,acted_by,comment,previous_status,new_status)
    VALUES(inv.id,'opening_payment_corrected',auth.uid(),
      'Historical payment '||req.amount||' recorded; correction '||req.id||'; '||btrim(_note),inv.status,final_status);
  RETURN req.id;
END $function$;

REVOKE ALL ON FUNCTION public.request_opening_payment_amendment(uuid,timestamptz,numeric,date,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.review_opening_payment_amendment(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_opening_payment_amendment(uuid,timestamptz,numeric,date,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_opening_payment_amendment(uuid,text,text) TO authenticated;
