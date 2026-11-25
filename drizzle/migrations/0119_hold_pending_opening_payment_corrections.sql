-- Prevent new settlements while an omitted historical payment is under review.
-- Both request_opening_payment_amendment and this trigger lock the invoice row,
-- so concurrent scheduling/advance adjustment cannot race the pending check.
CREATE FUNCTION public.guard_pending_opening_payment_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  PERFORM 1 FROM public.vendor_invoices WHERE id=NEW.invoice_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.opening_payment_amendments
            WHERE invoice_id=NEW.invoice_id AND status='pending') THEN
    RAISE EXCEPTION 'Resolve the pending historical payment correction before settling this invoice';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.guard_pending_opening_payment_correction() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER hold_vendor_payment_for_opening_correction
BEFORE INSERT OR UPDATE OF invoice_id,amount ON public.vendor_payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.guard_pending_opening_payment_correction();
CREATE TRIGGER hold_advance_for_opening_correction
BEFORE INSERT OR UPDATE OF invoice_id,amount ON public.vendor_advance_adjustments
FOR EACH ROW EXECUTE FUNCTION public.guard_pending_opening_payment_correction();
