-- STAGING/REVIEW ONLY: Director WhatsApp alerts; absolutely NO sending in SQL.
-- Requires 0012-0013 director approvals + 0020 company scope + 0022 phone normalization.
-- No existing documents, votes, suppliers or phone numbers are modified.
CREATE TABLE public.director_wa_consents (
  director_id uuid PRIMARY KEY REFERENCES public.profiles(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  status text NOT NULL CHECK (status IN ('granted','revoked')),
  phone_e164 text,
  evidence text NOT NULL CHECK (char_length(evidence) BETWEEN 12 AND 500),
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'granted' OR phone_e164 ~ '^[1-9][0-9]{7,14}$')
);
CREATE TABLE public.director_wa_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  director_id uuid NOT NULL REFERENCES public.profiles(id),
  decision text NOT NULL CHECK (decision IN ('granted','revoked')),
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX director_wa_consent_events_scope ON public.director_wa_consent_events(company_id,created_at DESC);

CREATE TABLE public.director_wa_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  director_id uuid NOT NULL REFERENCES public.profiles(id),
  entity_type text NOT NULL CHECK (entity_type IN ('purchase_order','vendor_payment')),
  entity_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('initial','reminder_1','reminder_2')),
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^[1-9][0-9]{7,14}$'),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','claimed','accepted','rejected','unknown','skipped')),
  claim_key uuid,
  claimed_at timestamptz,
  processed_at timestamptz,
  message_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,director_id,entity_type,entity_id,stage),
  CHECK ((status='claimed' AND claim_key IS NOT NULL AND claimed_at IS NOT NULL)
     OR (status<>'claimed'))
);
CREATE INDEX director_wa_outbox_queue_idx ON public.director_wa_outbox(status,created_at);
CREATE INDEX director_wa_outbox_company_idx ON public.director_wa_outbox(company_id,created_at DESC);
CREATE TABLE public.director_wa_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  outbox_id uuid NOT NULL REFERENCES public.director_wa_outbox(id),
  event_type text NOT NULL CHECK (event_type IN
    ('queued','claimed','accepted','rejected','unknown','skipped')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX director_wa_events_scope ON public.director_wa_outbox_events(company_id,occurred_at DESC);

ALTER TABLE public.director_wa_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.director_wa_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.director_wa_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.director_wa_outbox_events ENABLE ROW LEVEL SECURITY;

-- A director sees only their own notification metadata; an authorized super
-- administrator can review the company's queues. Management Viewer cannot.
CREATE POLICY "Own company director consent" ON public.director_wa_consents
 FOR SELECT TO authenticated USING (
  public.actor_in_company(company_id)
  AND (director_id=auth.uid() OR public.has_permission(auth.uid(),'users.manage'))
);
CREATE POLICY "Company administrators view director consent audit"
 ON public.director_wa_consent_events FOR SELECT TO authenticated USING (
 public.actor_in_company(company_id) AND public.has_permission(auth.uid(),'users.manage'));
CREATE POLICY "Own company director alerts" ON public.director_wa_outbox
 FOR SELECT TO authenticated USING (
  public.actor_in_company(company_id)
  AND (director_id=auth.uid() OR public.has_permission(auth.uid(),'users.manage'))
);
CREATE POLICY "Company administrators view director outbox audit"
 ON public.director_wa_outbox_events FOR SELECT TO authenticated USING (
 public.actor_in_company(company_id) AND public.has_permission(auth.uid(),'users.manage'));

REVOKE ALL ON TABLE public.director_wa_consents,public.director_wa_consent_events,
 public.director_wa_outbox,public.director_wa_outbox_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.director_wa_consents,public.director_wa_consent_events,
 public.director_wa_outbox,public.director_wa_outbox_events TO authenticated;
GRANT ALL ON TABLE public.director_wa_consents,public.director_wa_consent_events,
 public.director_wa_outbox,public.director_wa_outbox_events TO service_role;

-- Idempotent internal enqueue; no direct browser EXECUTE grant.
CREATE FUNCTION public.wa_queue_director_document(
  _company uuid,_kind text,_document uuid,_stage text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE doc record; d record; inserted_id uuid; enqueued integer:=0; eligible integer;
BEGIN
 IF _kind NOT IN ('purchase_order','vendor_payment')
    OR _stage NOT IN ('initial','reminder_1','reminder_2') THEN
   RAISE EXCEPTION 'Invalid director alert';
 END IF;
 IF _kind='purchase_order' THEN
   SELECT company_id,created_by,status,po_number AS number INTO doc
   FROM public.purchase_orders WHERE id=_document;
 ELSE
   SELECT company_id,created_by,status,payment_number AS number INTO doc
   FROM public.vendor_payments WHERE id=_document;
 END IF;
 IF NOT FOUND OR doc.company_id<>_company
   OR (_kind='purchase_order' AND doc.status::text<>'pending_approval')
   OR (_kind='vendor_payment' AND doc.status::text<>'scheduled') THEN
   RETURN 0;
 END IF;
 SELECT count(DISTINCT p.id) INTO eligible FROM public.profiles p
 JOIN public.user_roles r ON r.user_id=p.id AND r.role='director'
 WHERE p.company_id=_company AND p.is_active;
 IF eligible<>3 THEN RETURN 0; END IF;
 FOR d IN
   SELECT p.id AS director_id,c.phone_e164
   FROM public.profiles p JOIN public.user_roles r ON r.user_id=p.id AND r.role='director'
   JOIN public.director_wa_consents c ON c.director_id=p.id
   WHERE p.company_id=_company AND p.is_active AND p.id<>doc.created_by
     AND c.company_id=p.company_id AND c.status='granted'
     AND c.phone_e164=public.wa_normalize_mobile(p.phone)
     AND c.phone_e164 IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.director_approval_votes v
       WHERE v.entity_type=_kind AND v.entity_id=_document AND v.actor_id=p.id)
 LOOP
   inserted_id:=NULL;
   INSERT INTO public.director_wa_outbox(
     company_id,director_id,entity_type,entity_id,stage,phone_e164
   ) VALUES (_company,d.director_id,_kind,_document,_stage,d.phone_e164)
   ON CONFLICT (company_id,director_id,entity_type,entity_id,stage) DO NOTHING
   RETURNING id INTO inserted_id;
   IF inserted_id IS NOT NULL THEN
     enqueued:=enqueued+1;
     INSERT INTO public.director_wa_outbox_events(company_id,outbox_id,event_type)
      VALUES(_company,inserted_id,'queued');
   END IF;
 END LOOP;
 RETURN enqueued;
END $$;

CREATE FUNCTION public.wa_set_director_consent(
 _director uuid,_granted boolean,_evidence text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d record; previous text; phone text; decision text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'super_admin') THEN
   RAISE EXCEPTION 'Only super administrators may record director WhatsApp consent';
 END IF;
 IF _granted IS NULL OR char_length(btrim(coalesce(_evidence,''))) NOT BETWEEN 12 AND 500 THEN
   RAISE EXCEPTION 'A consent decision and 12-500 characters of evidence are required';
 END IF;
 SELECT p.id,p.company_id,p.phone INTO d FROM public.profiles p
 JOIN public.user_roles r ON r.user_id=p.id AND r.role='director'
 WHERE p.id=_director AND p.is_active FOR UPDATE OF p;
 IF NOT FOUND OR NOT public.actor_in_company(d.company_id) THEN
   RAISE EXCEPTION 'Director not found in your active company';
 END IF;
 phone:=public.wa_normalize_mobile(d.phone);
 IF _granted AND phone IS NULL THEN RAISE EXCEPTION 'Verify director phone number first'; END IF;
 decision:=CASE WHEN _granted THEN 'granted' ELSE 'revoked' END;
 INSERT INTO public.director_wa_consents
  (director_id,company_id,status,phone_e164,evidence,recorded_by)
 VALUES(_director,d.company_id,decision,phone,btrim(_evidence),auth.uid())
 ON CONFLICT(director_id) DO UPDATE SET
  status=EXCLUDED.status,phone_e164=EXCLUDED.phone_e164,
  evidence=EXCLUDED.evidence,recorded_by=EXCLUDED.recorded_by,recorded_at=now();
 INSERT INTO public.director_wa_consent_events(company_id,director_id,decision,recorded_by)
 VALUES(d.company_id,_director,decision,auth.uid());
 IF NOT _granted THEN
   UPDATE public.director_wa_outbox SET status='skipped',processed_at=now(),error_code='consent_revoked'
   WHERE company_id=d.company_id AND director_id=_director AND status='queued';
 END IF;
 RETURN _director;
END $$;

-- For older documents that entered pending status before the consent setup.
CREATE FUNCTION public.wa_prepare_director_notification(_kind text,_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE _company uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'super_admin') THEN
   RAISE EXCEPTION 'Super administrator required';
 END IF;
 IF _kind='purchase_order' THEN
   SELECT company_id INTO _company FROM public.purchase_orders WHERE id=_id;
 ELSIF _kind='vendor_payment' THEN
   SELECT company_id INTO _company FROM public.vendor_payments WHERE id=_id;
 ELSE RAISE EXCEPTION 'Unknown document kind'; END IF;
 IF _company IS NULL OR NOT public.actor_in_company(_company) THEN
   RAISE EXCEPTION 'Document outside current company';
 END IF;
 RETURN public.wa_queue_director_document(_company,_kind,_id,'initial');
END $$;

-- Trigger is a queue insertion only, NOT a WhatsApp send.
CREATE FUNCTION public.wa_queue_po_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status::text='pending_approval' AND
    (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
   PERFORM public.wa_queue_director_document(NEW.company_id,'purchase_order',NEW.id,'initial');
 ELSIF NEW.status::text<>'pending_approval' THEN
   UPDATE public.director_wa_outbox SET status='skipped',processed_at=now(),error_code='document_not_pending'
   WHERE entity_type='purchase_order' AND entity_id=NEW.id AND status='queued';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.wa_queue_payment_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status::text='scheduled' AND
    (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
   PERFORM public.wa_queue_director_document(NEW.company_id,'vendor_payment',NEW.id,'initial');
 ELSIF NEW.status::text<>'scheduled' THEN
   UPDATE public.director_wa_outbox SET status='skipped',processed_at=now(),error_code='document_not_pending'
   WHERE entity_type='vendor_payment' AND entity_id=NEW.id AND status='queued';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wa_po_status_alert AFTER INSERT OR UPDATE OF status
 ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.wa_queue_po_trigger();
CREATE TRIGGER wa_payment_status_alert AFTER INSERT OR UPDATE OF status
 ON public.vendor_payments FOR EACH ROW EXECUTE FUNCTION public.wa_queue_payment_trigger();

-- Re-evaluate consent, document state, company/director membership and votes
-- at the moment an exclusive claim is issued.
CREATE FUNCTION public.wa_director_claim_valid(_id uuid,_claim uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.director_wa_outbox o
  JOIN public.director_wa_consents c ON c.director_id=o.director_id
   AND c.company_id=o.company_id AND c.status='granted' AND c.phone_e164=o.phone_e164
  JOIN public.profiles p ON p.id=o.director_id AND p.is_active
   AND p.company_id=o.company_id AND c.phone_e164=public.wa_normalize_mobile(p.phone)
  JOIN public.user_roles ur ON ur.user_id=p.id AND ur.role='director'
  WHERE o.id=_id AND o.claim_key=_claim AND o.status='claimed'
   AND NOT EXISTS(SELECT 1 FROM public.director_approval_votes v
      WHERE v.entity_type=o.entity_type AND v.entity_id=o.entity_id AND v.actor_id=o.director_id)
   AND (
    (o.entity_type='purchase_order' AND EXISTS(SELECT 1 FROM public.purchase_orders po
      WHERE po.id=o.entity_id AND po.company_id=o.company_id
        AND po.status::text='pending_approval' AND po.created_by<>o.director_id))
    OR (o.entity_type='vendor_payment' AND EXISTS(SELECT 1 FROM public.vendor_payments pay
      WHERE pay.id=o.entity_id AND pay.company_id=o.company_id
        AND pay.status::text='scheduled' AND pay.created_by<>o.director_id))
   )
 )
$$;

CREATE FUNCTION public.wa_director_queue_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior record; queued integer:=0;
BEGIN
 -- At most two reminders; only after a previously ACCEPTED message and time
 -- delay. No automatic retry for unknown outcomes.
 FOR prior IN
   SELECT o.* FROM public.director_wa_outbox o
   WHERE o.status='accepted' AND o.processed_at IS NOT NULL
     AND ((o.stage='initial' AND o.processed_at<now()-interval '24 hours')
       OR (o.stage='reminder_1' AND o.processed_at<now()-interval '48 hours'))
   ORDER BY o.processed_at LIMIT 200
 LOOP
  queued:=queued+public.wa_queue_director_document(
    prior.company_id,prior.entity_type,prior.entity_id,
    CASE WHEN prior.stage='initial' THEN 'reminder_1' ELSE 'reminder_2' END
  );
 END LOOP;
 RETURN queued;
END $$;

CREATE FUNCTION public.wa_director_claim_batch(_max integer DEFAULT 3)
RETURNS TABLE(outbox_id uuid,lease_id uuid,phone text,kind text,number text,document_id uuid,notice_stage text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item record; token uuid; label text;
BEGIN
 IF _max IS NULL OR _max<1 OR _max>10 THEN RAISE EXCEPTION 'Invalid batch size'; END IF;
 -- Claimed requests are NEVER automatically retried: a crash may happen
 -- after Meta accepted the POST. Unknown status requires manual review.
 UPDATE public.director_wa_outbox SET status='unknown',processed_at=now(),
  error_code='claim_expired_unverified'
 WHERE status='claimed' AND claimed_at<now()-interval '15 minutes';
 FOR item IN SELECT o.* FROM public.director_wa_outbox o
   WHERE o.status='queued' ORDER BY o.created_at,o.id
   LIMIT _max FOR UPDATE SKIP LOCKED
 LOOP
   token:=gen_random_uuid();
   UPDATE public.director_wa_outbox SET status='claimed',claim_key=token,
     claimed_at=now() WHERE id=item.id;
   IF NOT public.wa_director_claim_valid(item.id,token) THEN
     UPDATE public.director_wa_outbox SET status='skipped',processed_at=now(),
       error_code='ineligible_at_claim' WHERE id=item.id;
     INSERT INTO public.director_wa_outbox_events(company_id,outbox_id,event_type)
       VALUES(item.company_id,item.id,'skipped');
     CONTINUE;
   END IF;
   IF item.entity_type='purchase_order' THEN
     SELECT po.po_number INTO label FROM public.purchase_orders po WHERE po.id=item.entity_id;
   ELSE
     SELECT pay.payment_number INTO label FROM public.vendor_payments pay WHERE pay.id=item.entity_id;
   END IF;
   INSERT INTO public.director_wa_outbox_events(company_id,outbox_id,event_type)
     VALUES(item.company_id,item.id,'claimed');
   outbox_id:=item.id;lease_id:=token;phone:=item.phone_e164;kind:=item.entity_type;
   number:=label;document_id:=item.entity_id;notice_stage:=item.stage;
   RETURN NEXT;
 END LOOP;
END $$;

CREATE FUNCTION public.wa_director_finish_claim(
 _id uuid,_lease uuid,_status text,_wamid text,_error text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE affected record;
BEGIN
 IF _status NOT IN ('accepted','rejected','unknown') THEN RAISE EXCEPTION 'Invalid result status'; END IF;
 IF _status='accepted' AND (coalesce(_wamid,'') NOT LIKE 'wamid.%' OR char_length(_wamid)>300)
 THEN RAISE EXCEPTION 'Meta acceptance requires a valid wamid'; END IF;
 UPDATE public.director_wa_outbox
   SET status=_status,processed_at=now(),message_id=CASE WHEN _status='accepted' THEN _wamid ELSE NULL END,
       error_code=left(coalesce(_error,''),80)
   WHERE id=_id AND claim_key=_lease AND status='claimed'
   RETURNING company_id,id INTO affected;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.director_wa_outbox_events(company_id,outbox_id,event_type)
  VALUES(affected.company_id,affected.id,_status);
 RETURN true;
END $$;

-- RPC-only client writes; background worker requires service_role key.
REVOKE ALL ON FUNCTION public.wa_queue_director_document(uuid,text,uuid,text),
 public.wa_set_director_consent(uuid,boolean,text),
 public.wa_prepare_director_notification(text,uuid),
 public.wa_queue_po_trigger(),public.wa_queue_payment_trigger(),
 public.wa_director_claim_valid(uuid,uuid),public.wa_director_queue_reminders(),
 public.wa_director_claim_batch(integer),
 public.wa_director_finish_claim(uuid,uuid,text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_set_director_consent(uuid,boolean,text),
 public.wa_prepare_director_notification(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wa_director_claim_valid(uuid,uuid),
 public.wa_director_queue_reminders(),public.wa_director_claim_batch(integer),
 public.wa_director_finish_claim(uuid,uuid,text,text,text) TO service_role;
