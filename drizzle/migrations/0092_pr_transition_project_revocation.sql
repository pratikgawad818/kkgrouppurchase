-- 0092: A former requester must not retain authority to submit/cancel
-- a PR after their project assignment is revoked. The SELECT RLS policy
-- in 0090 is not enough because this workflow RPC runs SECURITY DEFINER.
-- Retain every existing Director/self-approval and audit transition rule.
CREATE OR REPLACE FUNCTION public.pr_transition(_pr_id uuid, _action public.pr_action, _comment text DEFAULT NULL)
RETURNS public.pr_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p purchase_requests%ROWTYPE; v_uid uuid := auth.uid(); v_new pr_status; v_items int; v_director_origin boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT is_active_user(v_uid) THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO p FROM purchase_requests WHERE id = _pr_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase request not found.'; END IF;
  IF NOT public.actor_in_company(p.company_id) OR NOT public.can_access_project(v_uid,p.project_id) THEN RAISE EXCEPTION 'You do not have access to this project.'; END IF;
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
REVOKE ALL ON FUNCTION public.pr_transition(uuid,public.pr_action,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pr_transition(uuid,public.pr_action,text) TO authenticated;
