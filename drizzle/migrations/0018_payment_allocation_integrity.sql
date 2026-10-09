-- Proposed migration 0018. NOT deployed automatically by GitHub.
-- Database-level companion to payment scheduling preflight in PR #22.
-- Always run staging tests and confirm a restorable backup before deployment.
--
-- Historical violations must be reconciled manually, never erased.
DO $payment_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.vendor_payment_allocations
    GROUP BY payment_id,invoice_id HAVING COUNT(*)>1
  ) THEN RAISE EXCEPTION 'Duplicate invoice allocations in existing payments. Reconcile before migration 0018.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.vendor_payment_allocations
    WHERE amount<=0 OR amount<>round(amount,2)
  ) THEN RAISE EXCEPTION 'Invalid existing invoice payment allocation amount. Reconcile before migration 0018.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.vendor_payment_allocations al
    JOIN public.vendor_payments p ON p.id=al.payment_id
    JOIN public.vendor_invoices vi ON vi.id=al.invoice_id
    WHERE p.vendor_id<>vi.vendor_id OR p.company_id<>vi.company_id
  ) THEN RAISE EXCEPTION 'Invoice payments contain cross-vendor or cross-company allocations.'; END IF;
END $payment_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS vendor_payment_allocations_payment_invoice_uniq
ON public.vendor_payment_allocations(payment_id,invoice_id);
ALTER TABLE public.vendor_payment_allocations
 ADD CONSTRAINT vendor_payment_allocations_positive_paise
 CHECK (amount>0 AND amount=round(amount,2));

-- Replaces existing functions while preserving original transitions, posting
-- and audit behavior; only strengthens authorization and input validation.
CREATE OR REPLACE FUNCTION public.schedule_vendor_payment(_header jsonb, _allocations jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE pid uuid; k payment_kind; v record; a jsonb; inv record; open_alloc numeric; tot numeric := 0; amt numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'payment.schedule') THEN RAISE EXCEPTION 'No permission to schedule payments'; END IF;
  k := (_header->>'kind')::payment_kind;
  SELECT * INTO v FROM vendors WHERE id = (_header->>'vendor_id')::uuid;
  IF v IS NULL THEN RAISE EXCEPTION 'Vendor not found'; END IF;
  -- SECURITY DEFINER bypasses ordinary table RLS. Require the actor and
  -- vendor to belong to the same company before handling any payments.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.id=auth.uid() AND actor.is_active
      AND actor.company_id=v.company_id
  ) THEN RAISE EXCEPTION 'Vendor not found for your company'; END IF;
  IF nullif(_header->>'project_id','') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.projects pr
       WHERE pr.id=(_header->>'project_id')::uuid
         AND pr.company_id=v.company_id
         AND public.can_access_project(auth.uid(),pr.id)
     )
  THEN RAISE EXCEPTION 'Project not accessible for this payment'; END IF;
  IF nullif(_header->>'bank_account_id','') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.company_bank_accounts bank
      WHERE bank.id=(_header->>'bank_account_id')::uuid
        AND bank.company_id=v.company_id AND bank.status='active'
    )
  THEN RAISE EXCEPTION 'Bank account does not belong to this company or is inactive'; END IF;
  IF (_header->>'payment_date') IS NULL THEN RAISE EXCEPTION 'Payment date is required'; END IF;
  IF k = 'advance' THEN
    amt := (_header->>'amount')::numeric;
    IF amt IS NULL OR amt <= 0 OR amt <> round(amt,2)
      THEN RAISE EXCEPTION 'Enter a positive advance amount in rupees and paise'; END IF;
    IF coalesce(trim(_header->>'remarks'),'') = '' THEN RAISE EXCEPTION 'A purpose is required for an advance'; END IF;
  ELSE
    IF jsonb_array_length(coalesce(_allocations,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Select at least one invoice to pay'; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(_allocations) x
      GROUP BY x->>'invoice_id' HAVING COUNT(*) > 1
    ) THEN RAISE EXCEPTION 'The same vendor invoice cannot be allocated twice in one payment'; END IF;
    FOR a IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
      IF (a->>'amount')::numeric IS NULL
        OR (a->>'amount')::numeric <= 0
        OR (a->>'amount')::numeric <> round((a->>'amount')::numeric,2)
      THEN RAISE EXCEPTION 'Each invoice allocation must have a positive amount in rupees and paise'; END IF;
      SELECT * INTO inv FROM vendor_invoices WHERE id = (a->>'invoice_id')::uuid FOR UPDATE;
      IF inv IS NULL OR inv.vendor_id <> v.id OR inv.company_id <> v.company_id
        OR NOT public.can_access_project(auth.uid(),inv.project_id)
      THEN RAISE EXCEPTION 'Invoice is not accessible for this vendor and project'; END IF;
      IF inv.status NOT IN ('approved','partially_paid') THEN RAISE EXCEPTION 'Invoice % is not approved for payment', inv.invoice_number; END IF;
      SELECT coalesce(sum(al.amount),0) INTO open_alloc FROM vendor_payment_allocations al JOIN vendor_payments p ON p.id = al.payment_id
        WHERE al.invoice_id = inv.id AND p.status IN ('scheduled','approved');
      IF (a->>'amount')::numeric > inv.balance_due - open_alloc THEN
        RAISE EXCEPTION 'Invoice % has only % left to pay (incl. scheduled payments)', inv.invoice_number, inv.balance_due - open_alloc; END IF;
      tot := tot + (a->>'amount')::numeric;
    END LOOP;
    IF tot <= 0 THEN RAISE EXCEPTION 'Enter an amount to pay'; END IF;
    amt := tot;
  END IF;
  INSERT INTO vendor_payments(payment_number, company_id, vendor_id, kind, project_id, amount, payment_date, payment_mode, bank_account_id, reference, proof_path, remarks, created_by)
  VALUES (next_fy_doc_number(CASE WHEN k='advance' THEN 'VA' ELSE 'VP' END, CASE WHEN k='advance' THEN 'VA' ELSE 'VP' END), v.company_id, v.id, k,
    nullif(_header->>'project_id','')::uuid, amt, (_header->>'payment_date')::date, coalesce(_header->>'payment_mode','neft'),
    nullif(_header->>'bank_account_id','')::uuid, nullif(trim(coalesce(_header->>'reference','')),''), nullif(_header->>'proof_path',''),
    nullif(trim(coalesce(_header->>'remarks','')),''), auth.uid())
  RETURNING id INTO pid;
  IF k = 'invoice' THEN
    INSERT INTO vendor_payment_allocations(payment_id, invoice_id, amount)
    SELECT pid, (x->>'invoice_id')::uuid, (x->>'amount')::numeric FROM jsonb_array_elements(_allocations) x WHERE coalesce((x->>'amount')::numeric,0) > 0;
  END IF;
  INSERT INTO vendor_payment_events(payment_id, action, acted_by, new_status) VALUES (pid, 'scheduled', auth.uid(), 'scheduled');
  RETURN pid;
END $function$


CREATE OR REPLACE FUNCTION public.payment_transition(_id uuid, _action text, _comment text, _details jsonb)
 RETURNS payment_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p record; nxt payment_status; a record; prev payment_status; votes integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO p FROM vendor_payments WHERE id = _id FOR UPDATE;
  IF p IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
  -- Recording and cancellation must not allow an authorised user to act on
  -- another company's payment by passing a UUID directly to the RPC.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.id=auth.uid() AND actor.is_active
      AND actor.company_id=p.company_id
  ) OR (p.project_id IS NOT NULL AND NOT public.can_access_project(auth.uid(),p.project_id))
  THEN RAISE EXCEPTION 'Payment not accessible'; END IF;
  prev := p.status;
  IF _action = 'approve' THEN
    IF NOT has_permission(auth.uid(),'payment.approve') THEN RAISE EXCEPTION 'No permission to approve payments'; END IF;
    IF p.status <> 'scheduled' THEN RAISE EXCEPTION 'Only scheduled payments can be approved'; END IF;
    IF p.created_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve a payment you scheduled'; END IF;
    votes := register_director_vote('vendor_payment',_id,'approved',_comment);
    nxt := CASE WHEN votes=3 THEN 'approved' ELSE 'scheduled' END;
  ELSIF _action = 'record' THEN
    IF NOT has_permission(auth.uid(),'payment.record') THEN RAISE EXCEPTION 'No permission to record payments'; END IF;
    IF p.status <> 'approved' THEN RAISE EXCEPTION 'Only approved payments can be recorded'; END IF;
    IF coalesce(nullif(trim(coalesce(_details->>'reference','')),''), p.reference, '') = '' THEN RAISE EXCEPTION 'Enter the bank / UTR / cheque reference'; END IF;
    nxt := 'recorded';
  ELSIF _action = 'cancel' THEN
    IF NOT (has_permission(auth.uid(),'payment.schedule') OR has_permission(auth.uid(),'payment.approve')) THEN RAISE EXCEPTION 'No permission'; END IF;
    IF p.status NOT IN ('scheduled','approved') THEN RAISE EXCEPTION 'Recorded payments cannot be cancelled'; END IF;
    IF coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A cancellation reason is required'; END IF;
    nxt := 'cancelled';
  ELSE RAISE EXCEPTION 'Invalid action'; END IF;

  IF _action='approve' AND nxt='scheduled' THEN RETURN nxt; END IF;
  UPDATE vendor_payments SET status = nxt, updated_at = now(),
    approved_by = CASE WHEN nxt='approved' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN nxt='approved' THEN now() ELSE approved_at END,
    recorded_by = CASE WHEN nxt='recorded' THEN auth.uid() ELSE recorded_by END,
    recorded_at = CASE WHEN nxt='recorded' THEN now() ELSE recorded_at END,
    payment_date = CASE WHEN nxt='recorded' THEN coalesce(nullif(_details->>'payment_date','')::date, payment_date) ELSE payment_date END,
    reference = CASE WHEN nxt='recorded' THEN coalesce(nullif(trim(coalesce(_details->>'reference','')),''), reference) ELSE reference END,
    proof_path = CASE WHEN nxt='recorded' THEN coalesce(nullif(_details->>'proof_path',''), proof_path) ELSE proof_path END
  WHERE id = _id;

  IF nxt = 'recorded' THEN
    SELECT * INTO p FROM vendor_payments WHERE id = _id;
    PERFORM post_journal(p.company_id, p.payment_date, 'vendor_payment', p.id, p.vendor_id, p.project_id,
      CASE WHEN p.kind='advance' THEN 'Vendor advance ' ELSE 'Vendor payment ' END || p.payment_number || ' ref ' || p.reference,
      jsonb_build_array(
        jsonb_build_object('code', CASE WHEN p.kind='advance' THEN '1500' ELSE '2100' END, 'debit', p.amount),
        jsonb_build_object('code','1100','credit', p.amount)));
    FOR a IN SELECT invoice_id FROM vendor_payment_allocations WHERE payment_id = _id LOOP
      PERFORM vi_refresh_balance(a.invoice_id);
    END LOOP;
  END IF;
  INSERT INTO vendor_payment_events(payment_id, action, acted_by, comment, previous_status, new_status)
  VALUES (_id, _action, auth.uid(), nullif(trim(_comment),''), prev, nxt);
  RETURN nxt;
END $function$

