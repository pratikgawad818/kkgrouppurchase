CREATE OR REPLACE FUNCTION public.remind_po_approvers(_po_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.purchase_orders;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_permission(auth.uid(),'purchase_order.create') OR public.has_permission(auth.uid(),'purchase_order.approve')) THEN
    RAISE EXCEPTION 'No permission to send approval reminders'; END IF;
  SELECT * INTO p FROM public.purchase_orders WHERE id=_po_id FOR UPDATE;
  IF NOT FOUND OR NOT public.po_can_view(p.id) OR NOT public.actor_in_company(p.company_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF p.status<>'pending_approval' THEN RAISE EXCEPTION 'This purchase order is not waiting for approval'; END IF;
  INSERT INTO public.approval_reminder_events(po_id,actor_id) VALUES(p.id,auth.uid());
  PERFORM public.notify_document_approvers('purchase_order.approve',p.company_id,p.project_id,auth.uid(),
    'Reminder: purchase order '||p.po_number||' needs approval','₹'||p.grand_total::text,
    '/approvals?kind=purchase_order&id='||p.id);
END $$;
REVOKE ALL ON FUNCTION public.remind_po_approvers(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remind_po_approvers(uuid) TO authenticated;
COMMENT ON FUNCTION public.remind_po_approvers(uuid) IS 'Resend approval reminders immediately without a cooldown; retain authorization and append-only reminder history.';