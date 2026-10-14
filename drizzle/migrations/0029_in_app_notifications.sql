CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON public.notifications(user_id, created_at DESC);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own notifications read" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Own notifications mark read" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.notify_permission_holders(_perm text, _exclude uuid, _title text, _body text, _link text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications(user_id, title, body, link)
  SELECT DISTINCT ur.user_id, _title, _body, _link FROM public.user_roles ur
  WHERE public.has_permission(ur.user_id, _perm) AND ur.user_id IS DISTINCT FROM _exclude;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_permission_holders(text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_on_pr_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'pending_approval' THEN
      PERFORM public.notify_permission_holders('purchase_request.approve', NEW.requested_by,
        'Purchase request ' || NEW.pr_number || ' needs approval',
        'Estimated ₹' || coalesce(to_char(NEW.estimated_total, 'FM99,99,99,99,990'), '0'),
        '/procurement/purchase-requests/' || NEW.id);
    ELSIF NEW.status IN ('approved','rejected') AND NEW.requested_by IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, title, link)
      VALUES (NEW.requested_by, 'Purchase request ' || NEW.pr_number || ' was ' || NEW.status::text,
        '/procurement/purchase-requests/' || NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notify_pr_status AFTER UPDATE OF status ON public.purchase_requests FOR EACH ROW EXECUTE FUNCTION public.notify_on_pr_status();

CREATE OR REPLACE FUNCTION public.notify_on_invoice_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'pending_review' THEN
      PERFORM public.notify_permission_holders('vendor_invoice.approve', NEW.created_by,
        'Invoice ' || NEW.invoice_number || ' needs approval',
        'Amount ₹' || coalesce(to_char(NEW.grand_total, 'FM99,99,99,99,990'), '0'),
        '/finance/vendor-invoices/' || NEW.id);
    ELSIF NEW.status = 'exception' THEN
      PERFORM public.notify_permission_holders('vendor_invoice.approve_exception', NEW.created_by,
        'Invoice ' || NEW.invoice_number || ' has a matching exception',
        'Director review required', '/finance/vendor-invoices/' || NEW.id);
    ELSIF NEW.status IN ('approved','rejected') AND NEW.created_by IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, title, link)
      VALUES (NEW.created_by, 'Invoice ' || NEW.invoice_number || ' was ' || NEW.status::text,
        '/finance/vendor-invoices/' || NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notify_invoice_status AFTER INSERT OR UPDATE OF status ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.notify_on_invoice_status();

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;