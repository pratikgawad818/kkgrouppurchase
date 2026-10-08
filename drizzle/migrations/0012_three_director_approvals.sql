-- Three independent director votes are required before PO/payment approval.
-- Do not apply until the company has exactly three active director accounts.
CREATE TABLE IF NOT EXISTS public.director_approval_votes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entity_type text NOT NULL CHECK (entity_type IN ('purchase_order','vendor_payment')),
 entity_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.profiles(id),
 decision text NOT NULL CHECK (decision IN ('approved','rejected')),
 comment text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(entity_type,entity_id,actor_id)
);
CREATE INDEX IF NOT EXISTS director_approval_votes_entity_idx ON public.director_approval_votes(entity_type,entity_id);
ALTER TABLE public.director_approval_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Directors view approval votes" ON public.director_approval_votes FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'director')
);
GRANT SELECT ON public.director_approval_votes TO authenticated;
GRANT ALL ON public.director_approval_votes TO service_role;

CREATE OR REPLACE FUNCTION public.register_director_vote(_type text,_id uuid,_decision text,_comment text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer; eligible integer;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM user_roles r JOIN profiles p ON p.id=r.user_id
  WHERE r.user_id=auth.uid() AND r.role='director' AND p.is_active
 ) THEN RAISE EXCEPTION 'Only an active director may vote'; END IF;
 SELECT count(DISTINCT r.user_id) INTO eligible FROM user_roles r JOIN profiles p ON p.id=r.user_id WHERE r.role='director' AND p.is_active;
 IF eligible <> 3 THEN RAISE EXCEPTION 'Exactly three active directors must be configured (currently %)',eligible; END IF;
 IF _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid vote'; END IF;
 INSERT INTO director_approval_votes(entity_type,entity_id,actor_id,decision,comment)
 VALUES (_type,_id,auth.uid(),_decision,nullif(trim(_comment),''));
 SELECT count(*) INTO n FROM director_approval_votes WHERE entity_type=_type AND entity_id=_id AND decision='approved';
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.register_director_vote(text,uuid,text,text) FROM PUBLIC,authenticated;

CREATE OR REPLACE FUNCTION public.po_transition(_po_id uuid, _action po_action, _comment text) RETURNS po_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; nxt po_status; votes integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO p FROM purchase_orders WHERE id = _po_id FOR UPDATE;
  IF p IS NULL OR NOT can_access_project(auth.uid(), p.project_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF _action = 'submitted' THEN
    IF NOT has_permission(auth.uid(),'purchase_order.create') THEN RAISE EXCEPTION 'No permission'; END IF;
    IF p.status NOT IN ('draft','rejected') THEN RAISE EXCEPTION 'Only draft or rejected POs can be submitted'; END IF;
    IF p.delivery_warehouse_id IS NULL THEN RAISE EXCEPTION 'Choose a delivery store before submitting'; END IF;
    DELETE FROM director_approval_votes WHERE entity_type='purchase_order' AND entity_id=_po_id;
    nxt := 'pending_approval';
  ELSIF _action IN ('approved','rejected') THEN
    IF NOT has_permission(auth.uid(),'purchase_order.approve') THEN RAISE EXCEPTION 'No permission to approve purchase orders'; END IF;
    IF p.status <> 'pending_approval' THEN RAISE EXCEPTION 'PO is not pending approval'; END IF;
    IF p.created_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve or reject a PO you created'; END IF;
    IF _action = 'rejected' AND coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
    votes := register_director_vote('purchase_order',_po_id,CASE WHEN _action='approved' THEN 'approved' ELSE 'rejected' END,_comment);
    nxt := CASE WHEN _action='rejected' THEN 'rejected' WHEN votes=3 THEN 'approved' ELSE 'pending_approval' END;
  ELSIF _action = 'sent' THEN
    IF NOT has_permission(auth.uid(),'purchase_order.create') THEN RAISE EXCEPTION 'No permission'; END IF;
    IF p.status <> 'approved' THEN RAISE EXCEPTION 'Only approved POs can be marked as sent'; END IF;
    nxt := 'sent';
  ELSIF _action = 'cancelled' THEN
    IF NOT has_permission(auth.uid(),'purchase_order.cancel') THEN RAISE EXCEPTION 'No permission to cancel'; END IF;
    IF p.status NOT IN ('draft','pending_approval','approved','rejected','sent') THEN RAISE EXCEPTION 'PO cannot be cancelled once goods are received'; END IF;
    IF EXISTS (SELECT 1 FROM goods_receipt_notes WHERE po_id = _po_id AND status <> 'cancelled') THEN RAISE EXCEPTION 'PO has goods receipts'; END IF;
    IF coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A cancellation reason is required'; END IF;
    nxt := 'cancelled';
  ELSIF _action = 'closed' THEN
    IF NOT has_permission(auth.uid(),'purchase_order.approve') THEN RAISE EXCEPTION 'No permission'; END IF;
    IF p.status NOT IN ('partially_received','partially_accepted','fully_received','short_closed') THEN RAISE EXCEPTION 'Only received POs can be closed'; END IF;
    IF p.status IN ('partially_received','partially_accepted') AND coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A reason is required to close a PO with pending quantity'; END IF;
    nxt := 'closed';
  ELSE RAISE EXCEPTION 'Invalid action'; END IF;
  IF _action='approved' AND nxt='pending_approval' THEN RETURN nxt; END IF;
  UPDATE purchase_orders SET status = nxt, updated_at = now(),
    approved_by = CASE WHEN nxt = 'approved' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN nxt = 'approved' THEN now() ELSE approved_at END,
    sent_at = CASE WHEN nxt = 'sent' THEN now() ELSE sent_at END
    WHERE id = _po_id;
  INSERT INTO purchase_order_approvals(po_id, action, acted_by, comment, previous_status, new_status) VALUES (_po_id, _action, auth.uid(), nullif(trim(_comment),''), p.status, nxt);
  PERFORM log_event('po_' || _action::text, 'PO', p.po_number, p.id, _comment, jsonb_build_object('status', p.status), jsonb_build_object('status', nxt));
  RETURN nxt;
END $$;

CREATE OR REPLACE FUNCTION public.payment_transition(_id uuid, _action text, _comment text, _details jsonb)
RETURNS payment_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; nxt payment_status; a record; prev payment_status; votes integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO p FROM vendor_payments WHERE id = _id FOR UPDATE;
  IF p IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
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
END $$;
