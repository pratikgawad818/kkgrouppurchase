-- 0086: A Site Engineer can inspect the supplier quotation SELECTED for a
-- purchase order they are already authorised to view. Raw quotation rows
-- remain RLS-protected (unselected competing bids stay hidden).
--
-- Root cause: PostgREST's embedded vendor_quotations(...) relation is NULL
-- for site engineers (quotation.view is not granted), despite a valid
-- po.quotation_id and a quotation file already stored privately.

CREATE OR REPLACE FUNCTION public.get_po_selected_supplier_quotation(_po_id uuid)
RETURNS TABLE (
  quotation_id uuid,
  quotation_number text,
  attachment_path text,
  quotation_date date,
  payment_terms text,
  remarks text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  actor uuid := auth.uid();
  selected_po public.purchase_orders%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor)
     OR NOT public.has_permission(actor,'purchase_order.view') THEN
    RAISE EXCEPTION 'Purchase-order quotation access denied';
  END IF;

  SELECT * INTO selected_po
  FROM public.purchase_orders po
  WHERE po.id=_po_id;

  IF NOT FOUND
     OR NOT public.actor_in_company(selected_po.company_id)
     OR NOT public.can_access_project(actor,selected_po.project_id) THEN
    RAISE EXCEPTION 'Purchase order is not accessible';
  END IF;

  IF selected_po.status IN ('cancelled','closed')
     OR selected_po.quotation_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT q.id, q.quotation_number, q.attachment_path,
           q.quotation_date, q.payment_terms, q.remarks
    FROM public.vendor_quotations q
    JOIN public.rfqs r ON r.id=q.rfq_id
    WHERE q.id=selected_po.quotation_id
      AND r.company_id=selected_po.company_id
      AND r.project_id=selected_po.project_id;
END $$;

REVOKE ALL ON FUNCTION public.get_po_selected_supplier_quotation(uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_po_selected_supplier_quotation(uuid)
  TO authenticated;

-- The storage bucket is PRIVATE. Its SELECT policy already calls this helper.
-- Authorise only the actual quotation ID selected by a visible PO in the
-- same company/project. No general RFQ quotation permission is added.
CREATE OR REPLACE FUNCTION public.can_read_procurement_attachment(_path text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.purchase_requests pr
    WHERE pr.attachment_path=_path
      AND public.actor_in_company(pr.company_id)
      AND public.has_permission(auth.uid(),'purchase_request.view')
      AND (pr.requested_by=auth.uid()
           OR public.can_access_project(auth.uid(),pr.project_id))
  ) OR EXISTS (
    SELECT 1 FROM public.vendor_quotations qt
    JOIN public.rfqs r ON r.id=qt.rfq_id
    WHERE qt.attachment_path=_path
      AND public.actor_in_company(r.company_id)
      AND public.has_permission(auth.uid(),'quotation.view')
      AND public.rfq_can_view(qt.rfq_id)
  ) OR EXISTS (
    SELECT 1 FROM public.purchase_orders po
    JOIN public.vendor_quotations qt ON qt.id=po.quotation_id
    JOIN public.rfqs r ON r.id=qt.rfq_id
    WHERE qt.attachment_path=_path
      AND po.company_id=r.company_id
      AND po.project_id=r.project_id
      AND po.status NOT IN ('cancelled','closed')
      AND public.actor_in_company(po.company_id)
      AND public.is_active_user(auth.uid())
      AND public.has_permission(auth.uid(),'purchase_order.view')
      AND public.can_access_project(auth.uid(),po.project_id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_procurement_attachment(text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_procurement_attachment(text)
  TO authenticated;
