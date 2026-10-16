-- Return only names of people attached to documents the caller may read.
-- Do not broaden profile access (email, phone, DOB and role data stay protected).
CREATE FUNCTION public.document_actor_names(_kind text,_ids uuid[])
RETURNS TABLE(actor_id uuid,full_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _kind NOT IN ('purchase_order','vendor_payment','purchase_request') OR _kind IS NULL
    OR cardinality(_ids) IS NULL OR cardinality(_ids)>100 THEN RAISE EXCEPTION 'Invalid document lookup'; END IF;
  RETURN QUERY
  WITH readable AS (
    SELECT p.id,p.company_id,p.created_by,p.approved_by,NULL::uuid AS recorded_by
    FROM public.purchase_orders p WHERE _kind='purchase_order' AND p.id=ANY(_ids)
      AND public.actor_in_company(p.company_id) AND public.po_can_view(p.id)
    UNION ALL
    SELECT p.id,p.company_id,p.created_by,p.approved_by,p.recorded_by
    FROM public.vendor_payments p WHERE _kind='vendor_payment' AND p.id=ANY(_ids)
      AND public.actor_in_company(p.company_id) AND public.has_permission(auth.uid(),'payment.view')
      AND (p.project_id IS NULL OR public.can_access_project(auth.uid(),p.project_id))
    UNION ALL
    SELECT p.id,p.company_id,p.requested_by,p.approved_by,p.submitted_by
    FROM public.purchase_requests p WHERE _kind='purchase_request' AND p.id=ANY(_ids)
      AND public.actor_in_company(p.company_id) AND public.has_permission(auth.uid(),'purchase_request.view')
      AND public.can_access_project(auth.uid(),p.project_id)
  ), actors AS (
    SELECT r.company_id,unnest(ARRAY[r.created_by,r.approved_by,r.recorded_by]) AS uid FROM readable r
    UNION ALL SELECT r.company_id,a.acted_by FROM readable r JOIN public.purchase_order_approvals a ON a.po_id=r.id WHERE _kind='purchase_order'
    UNION ALL SELECT r.company_id,a.acted_by FROM readable r JOIN public.vendor_payment_events a ON a.payment_id=r.id WHERE _kind='vendor_payment'
    UNION ALL SELECT r.company_id,a.acted_by FROM readable r JOIN public.purchase_request_approvals a ON a.purchase_request_id=r.id WHERE _kind='purchase_request'
    UNION ALL SELECT r.company_id,a.actor_id FROM readable r JOIN public.director_approval_votes a ON a.entity_id=r.id AND a.entity_type=_kind
  )
  SELECT DISTINCT p.id,p.full_name FROM actors a JOIN public.profiles p ON p.id=a.uid AND p.company_id=a.company_id;
END $$;
REVOKE ALL ON FUNCTION public.document_actor_names(text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.document_actor_names(text,uuid[]) TO authenticated;
