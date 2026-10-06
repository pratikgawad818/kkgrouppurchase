CREATE OR REPLACE FUNCTION public.invoice_transition(_id uuid, _action text, _comment text)
 RETURNS invoice_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE inv record; nxt invoice_status; m match_status;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO inv FROM vendor_invoices WHERE id = _id FOR UPDATE;
  IF inv IS NULL OR NOT can_access_project(auth.uid(), inv.project_id) THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF _action = 'submit' THEN
    IF NOT (has_permission(auth.uid(),'vendor_invoice.create') OR has_permission(auth.uid(),'vendor_invoice.review')) THEN RAISE EXCEPTION 'No permission'; END IF;
    IF inv.status NOT IN ('draft','exception') THEN RAISE EXCEPTION 'Only draft invoices can be submitted'; END IF;
    m := run_invoice_match(_id);
    nxt := CASE WHEN m = 'matched' THEN 'pending_review' ELSE 'exception' END;
  ELSIF _action = 'approve' THEN
    IF NOT has_permission(auth.uid(),'vendor_invoice.approve') THEN RAISE EXCEPTION 'No permission to approve invoices'; END IF;
    IF inv.status <> 'pending_review' THEN RAISE EXCEPTION 'Only matched invoices pending review can be approved'; END IF;
    IF inv.created_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve an invoice you entered'; END IF;
    nxt := 'approved';
  ELSIF _action = 'approve_exception' THEN
    IF NOT has_permission(auth.uid(),'vendor_invoice.approve_exception') THEN RAISE EXCEPTION 'Only a Director can approve match exceptions'; END IF;
    IF inv.status <> 'exception' THEN RAISE EXCEPTION 'Invoice has no exception to approve'; END IF;
    IF inv.created_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve an invoice you entered'; END IF;
    IF coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A reason is required to approve an exception'; END IF;
    nxt := 'approved';
  ELSIF _action = 'reject' THEN
    IF NOT (has_permission(auth.uid(),'vendor_invoice.approve') OR has_permission(auth.uid(),'vendor_invoice.approve_exception')) THEN RAISE EXCEPTION 'No permission'; END IF;
    IF inv.status NOT IN ('pending_review','exception') THEN RAISE EXCEPTION 'Invoice is not awaiting a decision'; END IF;
    IF coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
    nxt := 'rejected';
  ELSIF _action = 'cancel' THEN
    IF NOT has_permission(auth.uid(),'vendor_invoice.create') THEN RAISE EXCEPTION 'No permission'; END IF;
    IF inv.status NOT IN ('draft','exception','rejected') THEN RAISE EXCEPTION 'Approved invoices cannot be cancelled'; END IF;
    IF coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A cancellation reason is required'; END IF;
    nxt := 'cancelled';
  ELSE RAISE EXCEPTION 'Invalid action'; END IF;

  UPDATE vendor_invoices SET status = nxt, updated_at = now(),
    balance_due = CASE WHEN nxt IN ('rejected','cancelled') THEN 0 ELSE balance_due END,
    approved_by = CASE WHEN nxt = 'approved' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN nxt = 'approved' THEN now() ELSE approved_at END
  WHERE id = _id;

  IF nxt = 'approved' THEN
    PERFORM post_journal(inv.company_id, inv.vendor_invoice_date, 'vendor_invoice', inv.id, inv.vendor_id, inv.project_id,
      'Vendor invoice ' || inv.invoice_number || ' / bill ' || inv.vendor_invoice_number,
      jsonb_build_array(
        jsonb_build_object('code','1300','debit', inv.subtotal + inv.freight + inv.other_charges),
        jsonb_build_object('code','1400','debit', inv.tax_total),
        jsonb_build_object('code','2100','credit', inv.net_payable),
        jsonb_build_object('code','2200','credit', inv.tds_amount)));
  END IF;
  INSERT INTO vendor_invoice_events(invoice_id, action, acted_by, comment, previous_status, new_status)
  VALUES (_id, _action, auth.uid(), nullif(trim(_comment),''), inv.status, nxt);
  RETURN nxt;
END $function$;