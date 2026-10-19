-- Keep PR -> RFQ -> selected quotation -> PO intact. Only creator approval policy changes.
-- Super Admin takes precedence if an account has both roles: its PO still needs a different Director.
INSERT INTO public.role_permissions(role,permission_code) VALUES
 ('director','purchase_request.create'),('director','purchase_request.edit'),('director','purchase_request.submit'),
 ('director','purchase_order.create') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.pr_transition(_pr_id uuid, _action public.pr_action, _comment text DEFAULT NULL)
RETURNS public.pr_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p purchase_requests%ROWTYPE; v_uid uuid := auth.uid(); v_new pr_status; v_items int; v_director_origin boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT is_active_user(v_uid) THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO p FROM purchase_requests WHERE id = _pr_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase request not found.'; END IF;
  IF NOT (p.requested_by = v_uid OR can_access_project(v_uid, p.project_id)) THEN RAISE EXCEPTION 'You do not have access to this project.'; END IF;
  _comment := nullif(trim(coalesce(_comment,'')), '');

  IF _action = 'submitted' THEN
    v_director_origin := p.requested_by=v_uid AND public.has_role(v_uid,'director') AND NOT public.has_role(v_uid,'super_admin') AND public.actor_in_company(p.company_id);
    IF p.status <> 'draft' AND NOT(p.status='pending_approval' AND v_director_origin) THEN RAISE EXCEPTION 'Only draft requests can be submitted.'; END IF;
    IF p.requested_by <> v_uid OR NOT has_permission(v_uid,'purchase_request.submit') THEN RAISE EXCEPTION 'You cannot submit this request.'; END IF;
    SELECT count(*) INTO v_items FROM purchase_request_items WHERE purchase_request_id = _pr_id;
    IF v_items = 0 THEN RAISE EXCEPTION 'Add at least one item before submitting.'; END IF;
    IF coalesce(trim(p.purpose),'') = '' THEN RAISE EXCEPTION 'Purpose is required before submitting.'; END IF;
    v_new := CASE WHEN v_director_origin THEN 'approved'::pr_status ELSE 'pending_approval'::pr_status END;
  ELSIF _action IN ('approved','returned') THEN
    IF p.status <> 'pending_approval' THEN RAISE EXCEPTION 'Only pending requests can be approved or returned.'; END IF;
    IF NOT has_permission(v_uid,'purchase_request.approve') THEN RAISE EXCEPTION 'You do not have permission to approve.'; END IF;
    IF p.requested_by = v_uid THEN RAISE EXCEPTION 'You cannot approve or return your own request.'; END IF;
    IF _action = 'returned' AND _comment IS NULL THEN RAISE EXCEPTION 'A comment is required when returning a request.'; END IF;
    v_new := CASE WHEN _action = 'approved' THEN 'approved'::pr_status ELSE 'draft'::pr_status END;
  ELSIF _action = 'rejected' THEN
    IF p.status <> 'pending_approval' THEN RAISE EXCEPTION 'Only pending requests can be rejected.'; END IF;
    IF NOT has_permission(v_uid,'purchase_request.reject') THEN RAISE EXCEPTION 'You do not have permission to reject.'; END IF;
    IF p.requested_by = v_uid THEN RAISE EXCEPTION 'You cannot reject your own request.'; END IF;
    IF _comment IS NULL THEN RAISE EXCEPTION 'A reason is required when rejecting.'; END IF;
    v_new := 'rejected';
  ELSIF _action = 'cancelled' THEN
    IF p.status NOT IN ('draft','pending_approval') THEN RAISE EXCEPTION 'Only draft or pending requests can be cancelled.'; END IF;
    IF NOT has_permission(v_uid,'purchase_request.cancel') THEN RAISE EXCEPTION 'You do not have permission to cancel.'; END IF;
    IF p.requested_by <> v_uid AND NOT has_permission(v_uid,'purchase_request.approve') THEN RAISE EXCEPTION 'Only the requester or an approver can cancel.'; END IF;
    v_new := 'cancelled';
  ELSE
    RAISE EXCEPTION 'Unsupported action.';
  END IF;

  PERFORM set_config('app.pr_source', 'rpc', true);
  UPDATE purchase_requests SET status = v_new,
    submitted_at = CASE WHEN _action = 'submitted' THEN now() ELSE submitted_at END,
    submitted_by = CASE WHEN _action = 'submitted' THEN v_uid ELSE submitted_by END,
    approved_at = CASE WHEN _action = 'approved' OR v_director_origin THEN now() ELSE approved_at END,
    approved_by = CASE WHEN _action = 'approved' OR v_director_origin THEN v_uid ELSE approved_by END
  WHERE id = _pr_id;
  PERFORM set_config('app.pr_source', '', true);
  INSERT INTO purchase_request_approvals(purchase_request_id, action, acted_by, comment, previous_status, new_status)
  VALUES (_pr_id, _action, v_uid, _comment, p.status, v_new);
  IF v_director_origin THEN
    INSERT INTO purchase_request_approvals(purchase_request_id,action,acted_by,comment,previous_status,new_status)
    VALUES(_pr_id,'approved',v_uid,'Finalized by the requesting Director; no additional approval required.',p.status,v_new);
  END IF;
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION public.po_transition(_po_id uuid, _action po_action, _comment text)
 RETURNS po_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p record; nxt po_status; votes integer; director_origin boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO p FROM purchase_orders WHERE id = _po_id FOR UPDATE;
  IF p IS NULL OR NOT public.actor_in_company(p.company_id) OR NOT can_access_project(auth.uid(), p.project_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF _action = 'submitted' THEN
    IF NOT has_permission(auth.uid(),'purchase_order.create') THEN RAISE EXCEPTION 'No permission'; END IF;
    director_origin := p.created_by=auth.uid() AND public.has_role(auth.uid(),'director') AND NOT public.has_role(auth.uid(),'super_admin');
    IF p.status NOT IN ('draft','rejected') AND NOT(p.status='pending_approval' AND director_origin) THEN RAISE EXCEPTION 'Only draft or rejected POs can be submitted'; END IF;
    IF p.delivery_warehouse_id IS NULL THEN RAISE EXCEPTION 'Choose a delivery store before submitting'; END IF;
    DELETE FROM director_approval_votes WHERE entity_type='purchase_order' AND entity_id=_po_id;
    nxt := CASE WHEN director_origin THEN 'approved'::po_status ELSE 'pending_approval'::po_status END;
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
  IF director_origin THEN
    INSERT INTO purchase_order_approvals(po_id,action,acted_by,comment,previous_status,new_status)
    VALUES(_po_id,'approved',auth.uid(),'Finalized by the creating Director; no additional approval required.',p.status,nxt);
  END IF;
  PERFORM log_event('po_' || _action::text, 'PO', p.po_number, p.id, _comment, jsonb_build_object('status', p.status), jsonb_build_object('status', nxt));
  RETURN nxt;
END $function$
;


REVOKE ALL ON FUNCTION public.pr_transition(uuid,public.pr_action,text),public.po_transition(uuid,public.po_action,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pr_transition(uuid,public.pr_action,text),public.po_transition(uuid,public.po_action,text) TO authenticated;
