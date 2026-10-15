-- Retire the removed integration without deleting consent or delivery audit data.
-- Apply through the normal reviewed migration process after deploying the app.
-- Historical migration files remain immutable so existing installations replay.
DROP TRIGGER IF EXISTS wa_po_status_alert ON public.purchase_orders;
DROP TRIGGER IF EXISTS wa_payment_status_alert ON public.vendor_payments;

DROP FUNCTION IF EXISTS public.wa_prepare_director_notification(text,uuid);
DROP FUNCTION IF EXISTS public.wa_set_director_consent(uuid,boolean,text);
DROP FUNCTION IF EXISTS public.wa_director_queue_reminders();
DROP FUNCTION IF EXISTS public.wa_director_claim_batch(integer);
DROP FUNCTION IF EXISTS public.wa_director_claim_valid(uuid,uuid);
DROP FUNCTION IF EXISTS public.wa_director_finish_claim(uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.wa_queue_po_trigger();
DROP FUNCTION IF EXISTS public.wa_queue_payment_trigger();
DROP FUNCTION IF EXISTS public.wa_queue_director_document(uuid,text,uuid,text);
DROP FUNCTION IF EXISTS public.wa_cancel_notification_draft(uuid,text);
DROP FUNCTION IF EXISTS public.wa_create_notification_draft(uuid,text,uuid,text);
DROP FUNCTION IF EXISTS public.wa_record_vendor_consent(uuid,boolean,text,text);
DROP FUNCTION IF EXISTS public.wa_has_current_consent(uuid);
DROP FUNCTION IF EXISTS public.wa_normalize_mobile(text);

-- This schema must not be added to Supabase's exposed API schemas.
CREATE SCHEMA IF NOT EXISTS retired_integrations;
REVOKE ALL ON SCHEMA retired_integrations FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE table_name text;
BEGIN
 FOR table_name IN SELECT unnest(ARRAY[
   'wa_vendor_consents','wa_consent_events','wa_notification_drafts','wa_notification_events',
   'director_wa_consents','director_wa_consent_events','director_wa_outbox','director_wa_outbox_events'
 ]) LOOP
   IF to_regclass(format('public.%I',table_name)) IS NULL THEN CONTINUE; END IF;
   IF to_regclass(format('retired_integrations.%I',table_name)) IS NOT NULL THEN
     RAISE EXCEPTION 'Archive collision for %; inspect before retiring integration',table_name;
   END IF;
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',table_name);
   EXECUTE format('ALTER TABLE public.%I SET SCHEMA retired_integrations',table_name);
 END LOOP;
END $$;
