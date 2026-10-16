CREATE FUNCTION public.notify_document_approvers(_perm text,_company uuid,_project uuid,_exclude uuid,_title text,_body text,_link text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  INSERT INTO public.notifications(user_id,title,body,link)
  SELECT DISTINCT p.id,_title,_body,_link FROM public.profiles p
  WHERE p.is_active AND p.company_id=_company AND p.id IS DISTINCT FROM _exclude
    AND public.has_permission(p.id,_perm)
    AND (_project IS NULL OR public.can_access_project(p.id,_project))
    AND (_perm NOT IN ('purchase_order.approve','payment.approve') OR EXISTS (
      SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='director'));
$$;
REVOKE ALL ON FUNCTION public.notify_document_approvers(text,uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.notify_document_creator(_user uuid,_company uuid,_project uuid,_title text,_link text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  INSERT INTO public.notifications(user_id,title,link)
    SELECT p.id,_title,_link FROM public.profiles p WHERE p.id=_user AND p.is_active AND p.company_id=_company
      AND (_project IS NULL OR public.can_access_project(p.id,_project));
$$;
REVOKE ALL ON FUNCTION public.notify_document_creator(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.notify_on_pr_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status='pending_approval' THEN
      PERFORM public.notify_document_approvers('purchase_request.approve',NEW.company_id,NEW.project_id,NEW.requested_by,
        'Purchase request '||NEW.pr_number||' needs approval','Review the requested materials and required date',
        '/procurement/purchase-requests/'||NEW.id);
    ELSIF NEW.status IN ('approved','rejected') THEN
      PERFORM public.notify_document_creator(NEW.requested_by,NEW.company_id,NEW.project_id,
        'Purchase request '||NEW.pr_number||' was '||NEW.status::text,'/procurement/purchase-requests/'||NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notify_on_invoice_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('pending_review','exception') THEN
      PERFORM public.notify_document_approvers(CASE WHEN NEW.status='exception' THEN 'vendor_invoice.approve_exception' ELSE 'vendor_invoice.approve' END,
        NEW.company_id,NEW.project_id,NEW.created_by,'Invoice '||NEW.invoice_number||' needs review',
        CASE WHEN NEW.status='exception' THEN 'Matching exception requires review' ELSE 'Amount ₹'||NEW.grand_total::text END,
        '/finance/vendor-invoices/'||NEW.id);
    ELSIF NEW.status IN ('approved','rejected') THEN
      PERFORM public.notify_document_creator(NEW.created_by,NEW.company_id,NEW.project_id,
        'Invoice '||NEW.invoice_number||' was '||NEW.status::text,'/finance/vendor-invoices/'||NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notify_on_po_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status='pending_approval' THEN
      PERFORM public.notify_document_approvers('purchase_order.approve',NEW.company_id,NEW.project_id,NEW.created_by,
        'Purchase order '||NEW.po_number||' needs approval','₹'||NEW.grand_total::text,
        '/approvals?kind=purchase_order&id='||NEW.id);
    ELSIF NEW.status IN ('approved','rejected') THEN
      PERFORM public.notify_document_creator(NEW.created_by,NEW.company_id,NEW.project_id,
        'Purchase order '||NEW.po_number||' was '||NEW.status::text,'/procurement/purchase-orders/'||NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.notify_on_payment_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status='scheduled' THEN
      PERFORM public.notify_document_approvers('payment.approve',NEW.company_id,NEW.project_id,NEW.created_by,
        'Vendor payment '||NEW.payment_number||' needs approval','₹'||NEW.amount::text,
        '/approvals?kind=vendor_payment&id='||NEW.id);
    ELSIF NEW.status IN ('approved','cancelled','recorded') THEN
      PERFORM public.notify_document_creator(NEW.created_by,NEW.company_id,NEW.project_id,
        'Vendor payment '||NEW.payment_number||' was '||NEW.status::text,'/finance/payments/'||NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notify_payment_status AFTER INSERT OR UPDATE OF status ON public.vendor_payments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_payment_status();

CREATE TABLE public.approval_reminder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),po_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approval_reminder_po_time ON public.approval_reminder_events(po_id,created_at DESC);
ALTER TABLE public.approval_reminder_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.approval_reminder_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.approval_reminder_events TO service_role;

CREATE OR REPLACE FUNCTION public.remind_po_approvers(_po_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.purchase_orders;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_permission(auth.uid(),'purchase_order.create') OR public.has_permission(auth.uid(),'purchase_order.approve')) THEN
    RAISE EXCEPTION 'No permission to send approval reminders'; END IF;
  SELECT * INTO p FROM public.purchase_orders WHERE id=_po_id FOR UPDATE;
  IF NOT FOUND OR NOT public.po_can_view(p.id) OR NOT public.actor_in_company(p.company_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF p.status<>'pending_approval' THEN RAISE EXCEPTION 'This purchase order is not waiting for approval'; END IF;
  IF EXISTS(SELECT 1 FROM public.approval_reminder_events WHERE po_id=p.id AND created_at>now()-interval '15 minutes') THEN
    RAISE EXCEPTION 'A reminder was sent recently. Please wait 15 minutes'; END IF;
  INSERT INTO public.approval_reminder_events(po_id,actor_id) VALUES(p.id,auth.uid());
  PERFORM public.notify_document_approvers('purchase_order.approve',p.company_id,p.project_id,auth.uid(),
    'Reminder: purchase order '||p.po_number||' needs approval','₹'||p.grand_total::text,
    '/approvals?kind=purchase_order&id='||p.id);
END $$;
DROP FUNCTION public.notify_permission_holders(text,uuid,text,text,text);
REVOKE ALL ON FUNCTION public.notify_on_pr_status(),public.notify_on_invoice_status(),public.notify_on_po_status(),
  public.notify_on_payment_status() FROM PUBLIC,anon,authenticated;
