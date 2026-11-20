-- 0087: Super Admin can remind eligible directors about pending approval.
-- In-app notifications only; the retired WhatsApp integration is not revived.
-- No approval vote, document status, or financial amount is changed.

CREATE OR REPLACE FUNCTION public.remind_po_approvers(_po_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  p public.purchase_orders;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) OR NOT (
    public.has_permission(auth.uid(), 'purchase_order.create')
    OR public.has_permission(auth.uid(), 'purchase_order.approve')
    OR EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = auth.uid() AND r.role = 'super_admin'
    )
  ) THEN
    RAISE EXCEPTION 'No permission to send approval reminders';
  END IF;

  SELECT * INTO p FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
  IF NOT FOUND OR NOT public.po_can_view(p.id)
    OR NOT public.actor_in_company(p.company_id) THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  IF p.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'This purchase order is not waiting for approval';
  END IF;

  INSERT INTO public.approval_reminder_events(po_id, actor_id)
    VALUES (p.id, auth.uid());

  PERFORM public.notify_document_approvers(
    'purchase_order.approve', p.company_id, p.project_id, auth.uid(),
    'Reminder: purchase order ' || p.po_number || ' needs approval',
    '₹' || p.grand_total::text,
    '/approvals?kind=purchase_order&id=' || p.id
  );
END $$;
REVOKE ALL ON FUNCTION public.remind_po_approvers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remind_po_approvers(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.remind_payment_approvers(_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  p public.vendor_payments;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) OR NOT EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = auth.uid() AND r.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only an active Super Admin can remind payment approvers';
  END IF;

  SELECT * INTO p FROM public.vendor_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_in_company(p.company_id)
    OR (p.project_id IS NOT NULL AND NOT public.can_access_project(auth.uid(), p.project_id)) THEN
    RAISE EXCEPTION 'Vendor payment not found';
  END IF;
  IF p.status <> 'scheduled' THEN
    RAISE EXCEPTION 'This vendor payment is not waiting for approval';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles recipient
    JOIN public.user_roles role ON role.user_id = recipient.id AND role.role = 'director'
    WHERE recipient.is_active
      AND recipient.company_id = p.company_id
      AND recipient.id IS DISTINCT FROM auth.uid()
      AND public.has_permission(recipient.id, 'payment.approve')
      AND (p.project_id IS NULL OR public.can_access_project(recipient.id, p.project_id))
  ) THEN
    RAISE EXCEPTION 'No eligible director is available to receive this payment reminder';
  END IF;

  PERFORM public.notify_document_approvers(
    'payment.approve', p.company_id, p.project_id, auth.uid(),
    'Reminder: vendor payment ' || p.payment_number || ' needs approval',
    '₹' || p.amount::text,
    '/approvals?kind=vendor_payment&id=' || p.id
  );

  PERFORM public.log_event(
    'payment_approval_reminder_sent', 'VendorPayment', p.payment_number, p.id,
    'In-app approval reminder sent by Super Admin',
    NULL::jsonb,
    jsonb_build_object('status', p.status, 'company_id', p.company_id)
  );
END $$;
REVOKE ALL ON FUNCTION public.remind_payment_approvers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remind_payment_approvers(uuid) TO authenticated;

COMMENT ON FUNCTION public.remind_payment_approvers(uuid) IS
'Super Admin sends a company/project-scoped in-app notification to eligible directors for a scheduled vendor payment; records an audit event and never changes payment approval.';
