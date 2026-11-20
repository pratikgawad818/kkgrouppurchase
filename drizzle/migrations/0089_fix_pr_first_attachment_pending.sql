-- 0089: Support recovery of the FIRST supporting file on an already
-- submitted purchase request, without allowing edits to an approved request.
--
-- Migration 0073 already authorizes the initial link on a pending PR, but
-- the legacy pr_before_write trigger blocks its header UPDATE because the
-- row is no longer in draft status. This RPC-only fix retains that trigger.

CREATE OR REPLACE FUNCTION public.set_purchase_request_attachment(
  _id uuid, _path text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  request public.purchase_requests%ROWTYPE;
  actor uuid := auth.uid();
  previous_source text := current_setting('app.pr_source', true);
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor)
     OR NOT public.has_permission(actor, 'purchase_request.edit') THEN
    RAISE EXCEPTION 'No permission to attach documents to purchase requests';
  END IF;

  SELECT * INTO request FROM public.purchase_requests
  WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR request.requested_by IS DISTINCT FROM actor
     OR NOT public.actor_in_company(request.company_id)
     OR NOT public.can_access_project(actor, request.project_id) THEN
    RAISE EXCEPTION 'Purchase request is not accessible';
  END IF;

  -- An identical retry is a no-op; uploaded evidence is immutable.
  IF request.attachment_path IS NOT DISTINCT FROM _path THEN RETURN; END IF;
  IF request.status NOT IN ('draft', 'pending_approval')
     OR (request.status='pending_approval' AND request.attachment_path IS NOT NULL) THEN
    RAISE EXCEPTION 'Attachment changes are locked after submission';
  END IF;

  IF _path IS NOT NULL
     AND NOT public.procurement_attachment_owned(_path, request.company_id, actor) THEN
    RAISE EXCEPTION 'Upload a PDF or image belonging to this account first';
  END IF;

  -- Bypass ONLY the old draft-only header guard after authorization above.
  -- Keep all other triggers/auditing and restore the transaction-local flag.
  PERFORM set_config('app.pr_source', 'rpc', true);
  UPDATE public.purchase_requests SET attachment_path=_path WHERE id=_id;
  PERFORM set_config('app.pr_source', coalesce(previous_source, ''), true);
END $$;

REVOKE ALL ON FUNCTION public.set_purchase_request_attachment(uuid,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_purchase_request_attachment(uuid,text)
  TO authenticated;

COMMENT ON FUNCTION public.set_purchase_request_attachment(uuid,text) IS
'Allow only the original requester to link an owned PDF/image to their draft or an initially unattached pending purchase request. Never changes approval status, items or approved records.';
