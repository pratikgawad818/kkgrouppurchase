-- 0081: Let an authorised PR viewer see the selected supplier quotation
-- already attached to a linked PO.  The PR attachment and the RFQ supplier
-- quotation are DIFFERENT documents; do not copy file paths into PR rows or
-- grant broad quotation.view permissions to Site Engineers.
--
-- This is a read-only view: no changes to approval decisions, status, stock,
-- RFQ selection, invoices or payment history.

CREATE OR REPLACE FUNCTION public.get_pr_selected_supplier_quotes(_pr_id uuid)
RETURNS TABLE (
  po_id uuid,
  po_number text,
  vendor_name text,
  quotation_number text,
  attachment_path text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  actor uuid := auth.uid();
  source_pr public.purchase_requests%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor)
     OR NOT public.has_permission(actor,'purchase_request.view')
     OR NOT public.has_permission(actor,'purchase_order.view') THEN
    RAISE EXCEPTION 'You are not allowed to view linked supplier quotations';
  END IF;

  SELECT * INTO source_pr
  FROM public.purchase_requests p
  WHERE p.id=_pr_id;
  IF NOT FOUND
     OR NOT public.actor_in_company(source_pr.company_id)
     OR NOT public.can_access_project(actor,source_pr.project_id) THEN
    RAISE EXCEPTION 'Purchase request is not accessible';
  END IF;

  RETURN QUERY
  SELECT po.id, po.po_number, supplier.company_name,
         quotation.quotation_number, quotation.attachment_path
    FROM public.purchase_orders po
    JOIN public.vendor_quotations quotation ON quotation.id=po.quotation_id
    LEFT JOIN public.rfqs rfq ON rfq.id=po.rfq_id
    LEFT JOIN public.vendors supplier ON supplier.id=po.vendor_id
   WHERE (po.purchase_request_id=_pr_id OR rfq.purchase_request_id=_pr_id)
     AND po.company_id=source_pr.company_id
     AND po.project_id=source_pr.project_id
     AND public.actor_in_company(po.company_id)
     AND public.can_access_project(actor,po.project_id)
     AND po.status NOT IN ('cancelled','closed')
   ORDER BY po.created_at DESC, po.id;
END $$;

REVOKE ALL ON FUNCTION public.get_pr_selected_supplier_quotes(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pr_selected_supplier_quotes(uuid)
  TO authenticated;

-- Existing private storage SELECT policy calls this function. A narrow
-- extra permission for the SELECTED quotation of a visible, same-project PO
-- allows the Site Engineer's PDF viewer to actually download its bytes.
-- Other competing vendor bids still require quotation.view + rfq.view.
CREATE OR REPLACE FUNCTION public.can_read_procurement_attachment(_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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
    SELECT 1
    FROM public.purchase_orders po
    JOIN public.vendor_quotations qt ON qt.id=po.quotation_id
    LEFT JOIN public.rfqs rfq ON rfq.id=po.rfq_id
    JOIN public.purchase_requests pr
      ON pr.id=COALESCE(po.purchase_request_id,rfq.purchase_request_id)
    WHERE qt.attachment_path=_path
      AND po.company_id=pr.company_id
      AND po.project_id=pr.project_id
      AND po.status NOT IN ('cancelled','closed')
      AND public.actor_in_company(po.company_id)
      AND public.has_permission(auth.uid(),'purchase_request.view')
      AND public.has_permission(auth.uid(),'purchase_order.view')
      AND public.can_access_project(auth.uid(),pr.project_id)
      AND public.can_access_project(auth.uid(),po.project_id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_procurement_attachment(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_procurement_attachment(text)
  TO authenticated;
