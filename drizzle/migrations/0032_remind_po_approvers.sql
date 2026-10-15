CREATE OR REPLACE FUNCTION public.remind_po_approvers(_po_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE p record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO p FROM purchase_orders WHERE id = _po_id;
  IF p IS NULL OR NOT can_access_project(auth.uid(), p.project_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF p.status <> 'pending_approval' THEN RAISE EXCEPTION 'This purchase order is not waiting for approval'; END IF;
  PERFORM notify_permission_holders('purchase_order.approve', auth.uid(),
    'Reminder: purchase order ' || p.po_number || ' needs approval',
    '₹' || coalesce(to_char(p.grand_total, 'FM99,99,99,99,990'), '0'),
    '/procurement/purchase-orders/' || p.id);
END $f$;
REVOKE ALL ON FUNCTION public.remind_po_approvers(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remind_po_approvers(uuid) TO authenticated;