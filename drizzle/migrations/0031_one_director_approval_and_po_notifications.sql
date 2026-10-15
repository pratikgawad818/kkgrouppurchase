DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.register_director_vote'::regproc);
  d := replace(d, $x$IF eligible <> 3 THEN
    RAISE EXCEPTION 'Exactly three active directors required for this company (currently %)', eligible;$x$, $x$IF eligible < 1 THEN
    RAISE EXCEPTION 'No active director for this company (currently %)', eligible;$x$);
  EXECUTE d;
  d := pg_get_functiondef('public.po_transition'::regproc);
  d := replace(d, $x$WHEN votes=3 THEN 'approved'$x$, $x$WHEN votes>=1 THEN 'approved'$x$);
  EXECUTE d;
  d := pg_get_functiondef('public.payment_transition'::regproc);
  d := replace(d, $x$WHEN votes=3 THEN 'approved'$x$, $x$WHEN votes>=1 THEN 'approved'$x$);
  EXECUTE d;
END $m$;

CREATE OR REPLACE FUNCTION public.notify_on_po_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'pending_approval' THEN
      PERFORM public.notify_permission_holders('purchase_order.approve', NEW.created_by,
        'Purchase order ' || NEW.po_number || ' needs approval',
        '₹' || coalesce(to_char(NEW.grand_total, 'FM99,99,99,99,990'), '0'),
        '/procurement/purchase-orders/' || NEW.id);
    ELSIF NEW.status IN ('approved','rejected') AND NEW.created_by IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, title, link)
      VALUES (NEW.created_by, 'Purchase order ' || NEW.po_number || ' was ' || NEW.status::text,
        '/procurement/purchase-orders/' || NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS notify_po_status ON public.purchase_orders;
CREATE TRIGGER notify_po_status AFTER UPDATE OF status ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.notify_on_po_status();