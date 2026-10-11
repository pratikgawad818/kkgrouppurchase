-- REVIEW/STAGING ONLY. Receipt tracking never sends messages or records votes.
-- Requires 0024. Acceptance status remains separate from delivery status.
ALTER TABLE public.director_wa_outbox
 ADD COLUMN delivery_status text CHECK (delivery_status IN ('sent','failed','delivered','read')),
 ADD COLUMN delivery_at timestamptz,
 ADD COLUMN delivery_error_code text CHECK (delivery_error_code ~ '^[0-9]{1,10}$');
CREATE UNIQUE INDEX director_wa_message_unique ON public.director_wa_outbox(message_id)
 WHERE message_id IS NOT NULL;
CREATE INDEX director_wa_recipient_active ON public.director_wa_outbox(phone_e164,id)
 WHERE status IN ('claimed','accepted');

-- A receipt may arrive before the worker writes its accepted wamid. Keep a
-- minimal private inbox and reconcile it when that write commits. No raw JSON,
-- message body, arbitrary error text or authentication secrets are stored.
CREATE TABLE public.director_wa_receipts (
 message_id text NOT NULL CHECK (message_id ~ '^wamid\.[A-Za-z0-9_.-]+$' AND char_length(message_id)<=296),
 recipient_id text NOT NULL CHECK (recipient_id ~ '^[1-9][0-9]{7,14}$'),
 status text NOT NULL CHECK (status IN ('sent','failed','delivered','read')),
 provider_timestamp bigint NOT NULL CHECK (provider_timestamp BETWEEN 1 AND 253402300799),
 error_code text CHECK (error_code ~ '^[0-9]{1,10}$'),
 received_at timestamptz NOT NULL DEFAULT now(),
 outbox_id uuid REFERENCES public.director_wa_outbox(id),
 PRIMARY KEY(message_id,recipient_id,status,provider_timestamp)
);
ALTER TABLE public.director_wa_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.director_wa_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.director_wa_receipts TO service_role;
CREATE INDEX director_wa_receipt_unmatched ON public.director_wa_receipts(received_at)
 WHERE outbox_id IS NULL;

CREATE FUNCTION public.wa_director_reconcile_receipts(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target record; strongest record;
BEGIN
 SELECT id,message_id,phone_e164,status INTO target
 FROM public.director_wa_outbox WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR target.status<>'accepted' OR target.message_id IS NULL THEN RETURN; END IF;
 UPDATE public.director_wa_receipts SET outbox_id=target.id
 WHERE message_id=target.message_id AND recipient_id=target.phone_e164 AND outbox_id IS NULL;
 SELECT status,provider_timestamp,error_code INTO strongest
 FROM public.director_wa_receipts WHERE outbox_id=target.id
 ORDER BY CASE status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3
   WHEN 'failed' THEN 2 ELSE 1 END DESC,provider_timestamp DESC LIMIT 1;
 IF FOUND THEN
   UPDATE public.director_wa_outbox SET delivery_status=strongest.status,
     delivery_at=to_timestamp(strongest.provider_timestamp),
     delivery_error_code=CASE WHEN strongest.status='failed' THEN strongest.error_code ELSE NULL END
   WHERE id=target.id;
 END IF;
END $$;

CREATE FUNCTION public.wa_director_receipt_acceptance_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='accepted' AND NEW.message_id IS NOT NULL THEN
   PERFORM public.wa_director_reconcile_receipts(NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wa_director_receipt_after_acceptance AFTER UPDATE OF message_id
 ON public.director_wa_outbox FOR EACH ROW
 EXECUTE FUNCTION public.wa_director_receipt_acceptance_trigger();

CREATE FUNCTION public.wa_director_record_receipts(_receipts jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE receipt record; target record; recorded integer:=0; added integer;
BEGIN
 IF _receipts IS NULL OR jsonb_typeof(_receipts)<>'array' THEN
   RAISE EXCEPTION 'Receipt array required';
 END IF;
 IF jsonb_array_length(_receipts) NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'Invalid receipt batch size';
 END IF;
 -- Lock before inserting receipts. This serializes receipt ingestion with
 -- finish_claim: either this RPC or its acceptance trigger sees the other
 -- committed result. Stable order also avoids overlapping-batch deadlocks.
 PERFORM o.id FROM public.director_wa_outbox o
 WHERE o.phone_e164 IN (SELECT x->>'recipient_id' FROM jsonb_array_elements(_receipts) x)
   AND o.status IN ('claimed','accepted')
 ORDER BY o.id FOR UPDATE;
 FOR receipt IN SELECT * FROM jsonb_to_recordset(_receipts) AS x(
   message_id text,recipient_id text,status text,provider_timestamp bigint,error_code text)
 LOOP
   IF receipt.message_id IS NULL OR receipt.message_id !~ '^wamid\.[A-Za-z0-9_.-]+$'
    OR char_length(receipt.message_id)>296
    OR receipt.recipient_id IS NULL OR receipt.recipient_id !~ '^[1-9][0-9]{7,14}$'
    OR receipt.status IS NULL OR receipt.status NOT IN ('sent','failed','delivered','read')
    OR receipt.provider_timestamp IS NULL OR receipt.provider_timestamp NOT BETWEEN 1 AND 253402300799
    OR (receipt.error_code IS NOT NULL AND receipt.error_code !~ '^[0-9]{1,10}$')
   THEN RAISE EXCEPTION 'Invalid receipt'; END IF;
   -- Only keep receipts that match an accepted message exactly or a director
   -- with an in-flight claim (the early-callback race). Unrelated messages
   -- are acknowledged without storing their metadata.
   IF NOT EXISTS(SELECT 1 FROM public.director_wa_outbox o
     WHERE o.phone_e164=receipt.recipient_id AND
       (o.status='claimed' OR (o.status='accepted' AND o.message_id=receipt.message_id)))
   THEN CONTINUE; END IF;
   INSERT INTO public.director_wa_receipts(message_id,recipient_id,status,provider_timestamp,error_code)
   VALUES(receipt.message_id,receipt.recipient_id,receipt.status,receipt.provider_timestamp,
     CASE WHEN receipt.status='failed' THEN receipt.error_code ELSE NULL END)
   ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS added=ROW_COUNT;
   recorded:=recorded+added;
 END LOOP;
 FOR target IN SELECT o.id FROM public.director_wa_outbox o
   WHERE o.status='accepted' AND EXISTS(SELECT 1 FROM jsonb_array_elements(_receipts) x
     WHERE x->>'message_id'=o.message_id AND x->>'recipient_id'=o.phone_e164)
   ORDER BY o.id
 LOOP
   PERFORM public.wa_director_reconcile_receipts(target.id);
 END LOOP;
 -- Unmatched early receipts expire; matched receipts remain immutable audit
 -- evidence. Cleanup runs with ingestion and can also be scheduled privately.
 DELETE FROM public.director_wa_receipts
 WHERE outbox_id IS NULL AND received_at<now()-interval '7 days';
 RETURN recorded;
END $$;

REVOKE ALL ON FUNCTION public.wa_director_reconcile_receipts(uuid),
 public.wa_director_receipt_acceptance_trigger(),public.wa_director_record_receipts(jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_director_record_receipts(jsonb) TO service_role;
