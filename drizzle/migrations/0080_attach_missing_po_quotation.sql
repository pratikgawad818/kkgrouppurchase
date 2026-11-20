CREATE OR REPLACE FUNCTION public.attach_missing_po_quotation(_po_id uuid, _path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  po record;
  q record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Sign in with an active account';
  END IF;
  SELECT * INTO po FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
  IF po IS NULL THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF NOT public.actor_in_company(po.company_id)
     OR NOT public.can_access_project(auth.uid(), po.project_id) THEN
    RAISE EXCEPTION 'You cannot access this purchase order';
  END IF;
  IF NOT (public.has_permission(auth.uid(), 'purchase_order.create')
          OR public.has_permission(auth.uid(), 'purchase_order.edit')
          OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'You do not have permission to attach quotations';
  END IF;
  IF po.status IN ('cancelled', 'closed') THEN
    RAISE EXCEPTION 'Quotations cannot be attached to a % purchase order', po.status;
  END IF;
  SELECT * INTO q FROM public.vendor_quotations WHERE id = po.quotation_id FOR UPDATE;
  IF q IS NULL THEN RAISE EXCEPTION 'This purchase order has no linked quotation'; END IF;
  IF q.attachment_path IS NOT NULL THEN
    RAISE EXCEPTION 'A quotation file is already attached';
  END IF;
  IF NOT public.procurement_attachment_owned(_path, po.company_id, auth.uid()) THEN
    RAISE EXCEPTION 'Upload the quotation file from this account first';
  END IF;
  UPDATE public.vendor_quotations SET attachment_path = _path WHERE id = q.id;
  PERFORM public.log_event('quotation_attached', 'purchase_order', po.po_number, po.id,
    'Missing supplier quotation attached after PO creation',
    jsonb_build_object('attachment_path', NULL),
    jsonb_build_object('attachment_path', _path, 'quotation_id', q.id),
    'vendor_quotation', q.id);
END $$;

REVOKE ALL ON FUNCTION public.attach_missing_po_quotation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_missing_po_quotation(uuid, text) TO authenticated;