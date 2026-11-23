-- PO PDF: resolve the original PR requester's name with PO-scoped permission.
-- Read-only; does not grant access to the company staff directory or edit documents.
CREATE OR REPLACE FUNCTION public.get_po_pr_requester_name(_po_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  actor uuid := auth.uid();
  selected_po public.purchase_orders%ROWTYPE;
  requester_name text;
BEGIN
  IF actor IS NULL
     OR NOT public.is_active_user(actor)
     OR NOT public.has_permission(actor, 'purchase_order.view') THEN
    RAISE EXCEPTION 'Purchase-order requester access denied';
  END IF;

  SELECT * INTO selected_po
  FROM public.purchase_orders po WHERE po.id=_po_id;
  IF NOT FOUND
     OR NOT public.po_can_view(selected_po.id)
     OR NOT public.actor_in_company(selected_po.company_id)
     OR NOT public.can_access_project(actor,selected_po.project_id) THEN
    RAISE EXCEPTION 'Purchase order not found or not accessible';
  END IF;

  SELECT nullif(btrim(profile.full_name),'')
    INTO requester_name
  FROM public.purchase_requests pr
  JOIN public.profiles profile ON profile.id=pr.requested_by
    AND profile.company_id=pr.company_id
  WHERE pr.id=selected_po.purchase_request_id
    AND pr.company_id=selected_po.company_id
    AND pr.project_id=selected_po.project_id;

  RETURN requester_name;
END $function$;
REVOKE ALL ON FUNCTION public.get_po_pr_requester_name(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_po_pr_requester_name(uuid) TO authenticated;
COMMENT ON FUNCTION public.get_po_pr_requester_name(uuid) IS
'Returns only the historical originating PR requester name to an active, authorized viewer of the exact PO in the same company and project.';
