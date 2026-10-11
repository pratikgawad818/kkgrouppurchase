-- REVIEW/STAGING ONLY: Supplier consent + draft-only WhatsApp outbox.
-- Requires 0020/0021 (company authorization). No existing rows are deleted.
-- No outbound sender, processing queue, webhook or production API capability.
-- Authenticated clients get SELECT only. All transitions occur via SECDEF RPCs.

CREATE TABLE public.wa_vendor_consents (
  vendor_id uuid PRIMARY KEY REFERENCES public.vendors(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  status text NOT NULL CHECK (status IN ('granted','revoked')),
  phone_e164 text,
  source text NOT NULL CHECK (source IN ('supplier_whatsapp','supplier_email','signed_document','telephone_call','other')),
  evidence_note text NOT NULL CHECK (char_length(evidence_note) BETWEEN 12 AND 1000),
  verified_by uuid NOT NULL REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'granted' OR phone_e164 ~ '^[1-9][0-9]{7,14}$')
);
CREATE INDEX wa_vendor_consents_company_idx ON public.wa_vendor_consents(company_id);

CREATE TABLE public.wa_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  previous_status text CHECK (previous_status IS NULL OR previous_status IN ('granted','revoked')),
  new_status text NOT NULL CHECK (new_status IN ('granted','revoked')),
  phone_e164 text,
  source text NOT NULL,
  evidence_note text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_consent_events_company_time_idx ON public.wa_consent_events(company_id,created_at DESC);

CREATE TABLE public.wa_notification_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  document_type text NOT NULL CHECK (document_type IN ('rfq','purchase_order','delivery_followup')),
  document_id uuid NOT NULL,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^[1-9][0-9]{7,14}$'),
  message_body text NOT NULL CHECK (char_length(message_body) BETWEEN 1 AND 3200),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','cancelled')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_by uuid REFERENCES public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  UNIQUE(company_id,vendor_id,document_type,document_id),
  CHECK ((status = 'draft' AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancel_reason IS NULL)
    OR (status = 'cancelled' AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND char_length(cancel_reason) BETWEEN 5 AND 500))
);
CREATE INDEX wa_notification_drafts_company_time_idx ON public.wa_notification_drafts(company_id,created_at DESC);

CREATE TABLE public.wa_notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  notification_id uuid NOT NULL REFERENCES public.wa_notification_drafts(id),
  event_type text NOT NULL CHECK (event_type IN ('draft_created','draft_cancelled')),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_notification_events_company_time_idx ON public.wa_notification_events(company_id,occurred_at DESC);

ALTER TABLE public.wa_vendor_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_notification_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_notification_events ENABLE ROW LEVEL SECURITY;

-- Read only to procurement administrators in their OWN company.
-- Management Viewer/auditor cannot browse phone numbers, evidence or drafts.
CREATE POLICY "Procurement views WhatsApp consent" ON public.wa_vendor_consents FOR SELECT TO authenticated
USING (public.actor_in_company(company_id) AND
  (public.has_permission(auth.uid(),'vendors.manage')
   OR public.has_permission(auth.uid(),'rfq.send')
   OR public.has_permission(auth.uid(),'purchase_order.create')));
CREATE POLICY "Procurement views consent events" ON public.wa_consent_events FOR SELECT TO authenticated
USING (public.actor_in_company(company_id) AND
  (public.has_permission(auth.uid(),'vendors.manage')
   OR public.has_permission(auth.uid(),'rfq.send')
   OR public.has_permission(auth.uid(),'purchase_order.create')));
CREATE POLICY "Procurement views scoped draft" ON public.wa_notification_drafts FOR SELECT TO authenticated
USING (public.actor_in_company(company_id) AND (
    (document_type='rfq'
      AND public.has_permission(auth.uid(),'rfq.send') AND EXISTS (
        SELECT 1 FROM public.rfqs r WHERE r.id=document_id AND r.company_id=wa_notification_drafts.company_id
        AND public.can_access_project(auth.uid(),r.project_id)
      ))
    OR
    (document_type IN ('purchase_order','delivery_followup')
      AND public.has_permission(auth.uid(),'purchase_order.create') AND EXISTS (
        SELECT 1 FROM public.purchase_orders po WHERE po.id=document_id AND po.company_id=wa_notification_drafts.company_id
        AND public.can_access_project(auth.uid(),po.project_id)
      ))
  ));
CREATE POLICY "Procurement views scoped draft events" ON public.wa_notification_events FOR SELECT TO authenticated
USING (public.actor_in_company(company_id) AND EXISTS (
  SELECT 1 FROM public.wa_notification_drafts draft
  WHERE draft.id=notification_id AND draft.company_id=wa_notification_events.company_id
));

GRANT SELECT ON public.wa_vendor_consents,public.wa_consent_events,
  public.wa_notification_drafts,public.wa_notification_events TO authenticated;
GRANT ALL ON public.wa_vendor_consents,public.wa_consent_events,
  public.wa_notification_drafts,public.wa_notification_events TO service_role;

-- Keep public/anonymous unprivileged. No INSERT, UPDATE or DELETE for
-- authenticated, and no corresponding write policies. Never mark 'sent'
-- merely because a wa.me link was opened.

CREATE OR REPLACE FUNCTION public.wa_normalize_mobile(_mobile text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE phone text := btrim(coalesce(_mobile,''));
BEGIN
  phone := regexp_replace(phone,'[ ()-]','','g');
  IF phone ~ '^[6-9][0-9]{9}$' THEN RETURN '91'||phone; END IF;
  IF phone ~ '^0[6-9][0-9]{9}$' THEN RETURN '91'||substr(phone,2); END IF;
  IF phone ~ '^\+[1-9][0-9]{7,14}$' THEN RETURN substr(phone,2); END IF;
  IF phone ~ '^[1-9][0-9]{10,14}$' THEN RETURN phone; END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.wa_has_current_consent(_vendor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.wa_vendor_consents consent
    JOIN public.vendors vendor ON vendor.id=consent.vendor_id
    WHERE consent.vendor_id=_vendor_id AND consent.status='granted'
      AND consent.company_id=vendor.company_id
      AND public.actor_in_company(vendor.company_id)
      AND (public.has_permission(auth.uid(),'vendors.manage')
        OR public.has_permission(auth.uid(),'rfq.send')
        OR public.has_permission(auth.uid(),'purchase_order.create'))
      AND consent.phone_e164=public.wa_normalize_mobile(vendor.mobile)
      AND consent.phone_e164 IS NOT NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.wa_record_vendor_consent(
  _vendor_id uuid, _granted boolean, _source text, _evidence text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE vendor_row record; old_status text; new_status text; normalized text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(),'vendors.manage') THEN
    RAISE EXCEPTION 'Not authorized to record supplier WhatsApp consent';
  END IF;
  IF _granted IS NULL OR _source NOT IN ('supplier_whatsapp','supplier_email','signed_document','telephone_call','other')
     OR _source IS NULL OR char_length(btrim(coalesce(_evidence,''))) NOT BETWEEN 12 AND 1000 THEN
    RAISE EXCEPTION 'Provide consent decision, evidence source and 12-1000 character evidence note';
  END IF;
  -- Lock vendor BEFORE reading/updating consent. Concurrent consent changes
  -- for the same vendor are serialized (including the first-ever record).
  SELECT id,company_id,mobile INTO vendor_row
    FROM public.vendors WHERE id=_vendor_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_in_company(vendor_row.company_id) THEN
    RAISE EXCEPTION 'Supplier is outside your active company';
  END IF;
  normalized := public.wa_normalize_mobile(vendor_row.mobile);
  IF _granted AND normalized IS NULL THEN
    RAISE EXCEPTION 'Supplier must have a valid verified WhatsApp number first';
  END IF;
  SELECT status INTO old_status FROM public.wa_vendor_consents WHERE vendor_id=_vendor_id;
  new_status := CASE WHEN _granted THEN 'granted' ELSE 'revoked' END;
  INSERT INTO public.wa_vendor_consents(
    vendor_id,company_id,status,phone_e164,source,evidence_note,verified_by,updated_at
  ) VALUES (
    _vendor_id,vendor_row.company_id,new_status,normalized,_source,btrim(_evidence),auth.uid(),now()
  )
  ON CONFLICT (vendor_id) DO UPDATE SET
    status=EXCLUDED.status,phone_e164=EXCLUDED.phone_e164,
    source=EXCLUDED.source,evidence_note=EXCLUDED.evidence_note,
    verified_by=EXCLUDED.verified_by,updated_at=now();
  INSERT INTO public.wa_consent_events(
    company_id,vendor_id,previous_status,new_status,phone_e164,source,evidence_note,actor_id
  ) VALUES (
    vendor_row.company_id,_vendor_id,old_status,new_status,normalized,_source,btrim(_evidence),auth.uid()
  );
  RETURN _vendor_id;
END
$$;

CREATE OR REPLACE FUNCTION public.wa_create_notification_draft(
  _vendor_id uuid,_document_type text,_document_id uuid,_message text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE vendor_row record; draft_id uuid; prior public.wa_notification_drafts%ROWTYPE;
        normalized text; body text := btrim(coalesce(_message,''));
BEGIN
  IF auth.uid() IS NULL OR _vendor_id IS NULL OR _document_id IS NULL
     OR char_length(body) NOT BETWEEN 1 AND 3200 THEN
    RAISE EXCEPTION 'Invalid supplier, document or draft message';
  END IF;
  SELECT id,company_id,mobile INTO vendor_row
    FROM public.vendors WHERE id=_vendor_id;
  IF NOT FOUND OR NOT public.actor_in_company(vendor_row.company_id) THEN
    RAISE EXCEPTION 'Supplier is outside your active company';
  END IF;
  normalized := public.wa_normalize_mobile(vendor_row.mobile);
  IF normalized IS NULL THEN RAISE EXCEPTION 'Supplier mobile number is missing or invalid'; END IF;

  IF _document_type = 'rfq' THEN
    IF NOT public.has_permission(auth.uid(),'rfq.send') OR NOT EXISTS (
      SELECT 1 FROM public.rfqs r
      JOIN public.rfq_vendors rv ON rv.rfq_id=r.id AND rv.vendor_id=_vendor_id
      WHERE r.id=_document_id AND r.company_id=vendor_row.company_id
        AND r.status IN ('draft','sent','partially_responded','fully_responded')
        AND public.can_access_project(auth.uid(),r.project_id)
    ) THEN RAISE EXCEPTION 'RFQ unavailable or permission denied'; END IF;
  ELSIF _document_type IN ('purchase_order','delivery_followup') THEN
    IF NOT public.has_permission(auth.uid(),'purchase_order.create') OR NOT EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.id=_document_id AND po.company_id=vendor_row.company_id AND po.vendor_id=_vendor_id
        AND public.can_access_project(auth.uid(),po.project_id)
        AND ((_document_type='purchase_order' AND po.status IN ('approved','sent'))
          OR (_document_type='delivery_followup' AND po.status IN ('approved','sent','partially_received','partially_accepted')))
    ) THEN RAISE EXCEPTION 'Purchase order not approved, unavailable or permission denied'; END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported WhatsApp draft document type';
  END IF;

  INSERT INTO public.wa_notification_drafts(
    company_id,vendor_id,document_type,document_id,phone_e164,message_body,created_by
  ) VALUES (
    vendor_row.company_id,_vendor_id,_document_type,_document_id,normalized,body,auth.uid()
  )
  ON CONFLICT (company_id,vendor_id,document_type,document_id) DO NOTHING
  RETURNING id INTO draft_id;

  IF draft_id IS NULL THEN
    SELECT * INTO prior FROM public.wa_notification_drafts
      WHERE company_id=vendor_row.company_id AND vendor_id=_vendor_id
        AND document_type=_document_type AND document_id=_document_id;
    IF prior.id IS NULL OR prior.message_body<>body OR prior.phone_e164<>normalized
       OR prior.status<>'draft' THEN
      RAISE EXCEPTION 'Existing draft cannot be overwritten, reopened or retargeted';
    END IF;
    RETURN prior.id; -- idempotent retry with identical material, no fake event
  END IF;
  INSERT INTO public.wa_notification_events(company_id,notification_id,event_type,actor_id)
    VALUES (vendor_row.company_id,draft_id,'draft_created',auth.uid());
  RETURN draft_id;
END
$$;

CREATE OR REPLACE FUNCTION public.wa_cancel_notification_draft(
  _draft_id uuid,_reason text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE row_data public.wa_notification_drafts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR char_length(btrim(coalesce(_reason,''))) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Cancellation requires an authenticated actor and a reason (5-500 characters)';
  END IF;
  SELECT * INTO row_data FROM public.wa_notification_drafts WHERE id=_draft_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_in_company(row_data.company_id) THEN
    RAISE EXCEPTION 'Draft is unavailable';
  END IF;
  IF NOT (
    (row_data.document_type='rfq' AND public.has_permission(auth.uid(),'rfq.send'))
    OR
    (row_data.document_type IN ('purchase_order','delivery_followup')
      AND public.has_permission(auth.uid(),'purchase_order.create'))
  ) THEN RAISE EXCEPTION 'Not authorized to cancel draft'; END IF;
  IF row_data.status='cancelled' THEN RETURN row_data.id; END IF;
  UPDATE public.wa_notification_drafts SET status='cancelled',cancelled_by=auth.uid(),
    cancelled_at=now(),cancel_reason=btrim(_reason) WHERE id=_draft_id;
  INSERT INTO public.wa_notification_events(company_id,notification_id,event_type,actor_id,reason)
    VALUES (row_data.company_id,_draft_id,'draft_cancelled',auth.uid(),btrim(_reason));
  RETURN _draft_id;
END
$$;

REVOKE ALL ON FUNCTION public.wa_normalize_mobile(text),
  public.wa_has_current_consent(uuid),
  public.wa_record_vendor_consent(uuid,boolean,text,text),
  public.wa_create_notification_draft(uuid,text,uuid,text),
  public.wa_cancel_notification_draft(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wa_has_current_consent(uuid),
  public.wa_record_vendor_consent(uuid,boolean,text,text),
  public.wa_create_notification_draft(uuid,text,uuid,text),
  public.wa_cancel_notification_draft(uuid,text) TO authenticated;
-- wa_normalize_mobile remains internal only (SECDEF functions may call it).
