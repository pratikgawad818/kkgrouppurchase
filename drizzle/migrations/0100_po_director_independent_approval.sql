-- 0100 SECURITY: No director can approve their own purchase order.
-- Live preflight (2026-11-21): three active directors, zero creator-approved POs.
-- This replaces the historical director-origin bypass in migration 0046.
-- Existing records and approval votes are left unchanged.
-- Director-authored POs follow the same pending_approval workflow as all
-- other POs. Only an eligible different director may grant approval, per
-- the existing PO approval action. Current quorum remains unchanged.

CREATE OR REPLACE FUNCTION public.po_transition(_po_id uuid, _action po_action, _comment text)
 RETURNS po_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p record; nxt po_status; votes integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO p FROM purchase_orders WHERE id = _po_id FOR UPDATE;
  IF p IS NULL OR NOT public.actor_in_company(p.company_id) OR NOT can_access_project(auth.uid(), p.project_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF _action = 'submitted' THEN
    IF NOT has_permission(auth.uid(),'purchase_order.create') THEN RAISE EXCEPTION 'No permission'; END IF;
    IF p.status NOT IN ('draft','rejected') THEN RAISE EXCEPTION 'Only draft or rejected POs can be submitted'; END IF;
    IF p.delivery_warehouse_id IS NULL THEN RAISE EXCEPTION 'Choose a delivery store before submitting'; END IF;
    DELETE FROM director_approval_votes WHERE entity_type='purchase_order' AND entity_id=_po_id;
    nxt := 'pending_approval'::po_status;
  ELSIF _action IN ('approved','rejected') THEN
    IF NOT has_permission(auth.uid(),'purchase_order.approve') THEN RAISE EXCEPTION 'No permission to approve purchase orders'; END IF;
    IF p.status <> 'pending_approval' THEN RAISE EXCEPTION 'PO is not pending approval'; END IF;
    IF p.created_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve or reject a PO you created'; END IF;
    IF _action = 'rejected' AND coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
    votes := register_director_vote('purchase_order',_po_id,CASE WHEN _action='approved' THEN 'approved' ELSE 'rejected' END,_comment);
    nxt := CASE WHEN _action='rejected' THEN 'rejected' WHEN votes>=1 THEN 'approved' ELSE 'pending_approval' END;
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
    approved_by = CASE WHEN nxt = 'approved' THEN auth.uid() WHEN nxt = 'pending_approval' THEN NULL ELSE approved_by END,
    approved_at = CASE WHEN nxt = 'approved' THEN now() WHEN nxt = 'pending_approval' THEN NULL ELSE approved_at END,
    sent_at = CASE WHEN nxt = 'sent' THEN now() ELSE sent_at END
    WHERE id = _po_id;
  INSERT INTO purchase_order_approvals(po_id, action, acted_by, comment, previous_status, new_status) VALUES (_po_id, _action, auth.uid(), nullif(trim(_comment),''), p.status, nxt);
  PERFORM log_event('po_' || _action::text, 'PO', p.po_number, p.id, _comment, jsonb_build_object('status', p.status), jsonb_build_object('status', nxt));
  RETURN nxt;
END $function$;

REVOKE ALL ON FUNCTION public.po_transition(uuid,public.po_action,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.po_transition(uuid,public.po_action,text) TO authenticated;
