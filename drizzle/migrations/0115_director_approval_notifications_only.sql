-- 0115: Directors receive only actionable PO and invoice PAYMENT approvals.
-- Existing PR/quotation/challan/GRN and invoice-review notifications for other
-- staff remain unchanged. A BEFORE INSERT gate stops unapproved Director
-- notification rows before the OS push dispatch trigger can run.
-- No historical notification, financial record, or approval decision is deleted.
CREATE OR REPLACE FUNCTION public.director_approval_notification_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  target_id uuid;
BEGIN
  -- Do not change the notification policy for staff without Director access.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = NEW.user_id AND r.role = 'director'
  ) THEN
    RETURN NEW;
  END IF;

  -- Only the two precise, actionable approval links are allowed for Directors.
  -- Match a canonical UUID before casting to avoid malformed-input exceptions.
  IF coalesce(NEW.link,'') ~
     '^/approvals\?kind=purchase_order&id=[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$' THEN
    target_id := split_part(NEW.link,'&id=',2)::uuid;
    IF EXISTS (
      SELECT 1 FROM public.purchase_orders po
      JOIN public.profiles recipient ON recipient.id=NEW.user_id
        AND recipient.company_id=po.company_id AND recipient.is_active
      WHERE po.id=target_id
        AND po.status='pending_approval'
        AND po.created_by IS DISTINCT FROM NEW.user_id
        AND public.has_permission(NEW.user_id,'purchase_order.approve')
        AND public.can_access_project(NEW.user_id,po.project_id)
    ) THEN
      RETURN NEW;
    END IF;
    RETURN NULL;
  END IF;

  IF coalesce(NEW.link,'') ~
     '^/approvals\?kind=vendor_payment&id=[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$' THEN
    target_id := split_part(NEW.link,'&id=',2)::uuid;
    IF EXISTS (
      SELECT 1 FROM public.vendor_payments payment
      JOIN public.profiles recipient ON recipient.id=NEW.user_id
        AND recipient.company_id=payment.company_id AND recipient.is_active
      WHERE payment.id=target_id
        AND payment.status='scheduled'
        AND payment.kind='invoice'
        AND payment.created_by IS DISTINCT FROM NEW.user_id
        AND public.has_permission(NEW.user_id,'payment.approve')
        AND (payment.project_id IS NULL OR
          public.can_access_project(NEW.user_id,payment.project_id))
    ) THEN
      RETURN NEW;
    END IF;
    RETURN NULL;
  END IF;

  -- PR approval, RFQ, invoice review, delivery, GRN, creator updates and
  -- vendor advances are NOT Director notification events.
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.director_approval_notification_gate()
  FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS director_approval_notification_only ON public.notifications;
CREATE TRIGGER director_approval_notification_only
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.director_approval_notification_gate();

COMMENT ON FUNCTION public.director_approval_notification_gate() IS
'Only eligible active Directors awaiting independent PO approval or scheduled invoice-payment approval receive a notification. Other employees and all business workflows remain unchanged.';
