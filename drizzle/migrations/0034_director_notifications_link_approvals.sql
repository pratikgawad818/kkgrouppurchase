CREATE OR REPLACE FUNCTION public.notify_on_po_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'pending_approval' THEN
      PERFORM public.notify_permission_holders('purchase_order.approve', NEW.created_by,
        'Purchase order ' || NEW.po_number || ' needs approval',
        '₹' || coalesce(to_char(NEW.grand_total, 'FM99,99,99,99,990'), '0'),
        '/approvals');
    ELSIF NEW.status IN ('approved','rejected') AND NEW.created_by IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, title, link)
      VALUES (NEW.created_by, 'Purchase order ' || NEW.po_number || ' was ' || NEW.status::text,
        '/procurement/purchase-orders/' || NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.remind_po_approvers(_po_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO p FROM purchase_orders WHERE id = _po_id;
  IF p IS NULL OR NOT can_access_project(auth.uid(), p.project_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF p.status <> 'pending_approval' THEN RAISE EXCEPTION 'This purchase order is not waiting for approval'; END IF;
  PERFORM notify_permission_holders('purchase_order.approve', auth.uid(),
    'Reminder: purchase order ' || p.po_number || ' needs approval',
    '₹' || coalesce(to_char(p.grand_total, 'FM99,99,99,99,990'), '0'),
    '/approvals');
END $$;