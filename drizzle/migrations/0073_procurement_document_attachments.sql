-- Procurement attachments are private evidence, not public links.
-- One active attachment path per PR / supplier quotation. Uploaded objects
-- are retained when replaced so historical document bytes are not overwritten.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS attachment_path text;

INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) VALUES (
  'procurement-attachments', 'procurement-attachments', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/png']
) ON CONFLICT (id) DO NOTHING;

-- All file names follow company_id / uploader_id / random_uuid.ext.
-- The uploader must be active, in the same company, and permitted to
-- originate purchase requests or supplier quotations.
DROP POLICY IF EXISTS "Procurement attachment upload" ON storage.objects;
CREATE POLICY "Procurement attachment upload"
ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='procurement-attachments'
  AND (storage.foldername(name))[1] = (
    SELECT p.company_id::text FROM public.profiles p
    WHERE p.id=auth.uid() AND p.is_active
  )
  AND (storage.foldername(name))[2]=auth.uid()::text
  AND storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$'
  AND (
    public.has_permission(auth.uid(),'purchase_request.create')
    OR public.has_permission(auth.uid(),'quotation.create')
  )
);

-- Security-definer checks only linked, company- and project-accessible
-- documents. Storage SELECT never grants everyone access to a whole bucket.
CREATE OR REPLACE FUNCTION public.can_read_procurement_attachment(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.purchase_requests pr
    WHERE pr.attachment_path=_path
      AND public.actor_in_company(pr.company_id)
      AND public.has_permission(auth.uid(),'purchase_request.view')
      AND (pr.requested_by=auth.uid()
           OR public.can_access_project(auth.uid(),pr.project_id))
  ) OR EXISTS (
    SELECT 1 FROM public.vendor_quotations qt
    JOIN public.rfqs r ON r.id=qt.rfq_id
    WHERE qt.attachment_path=_path
      AND public.actor_in_company(r.company_id)
      AND public.has_permission(auth.uid(),'quotation.view')
      AND public.rfq_can_view(qt.rfq_id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_procurement_attachment(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_procurement_attachment(text) TO authenticated;

DROP POLICY IF EXISTS "Procurement attachment read" ON storage.objects;
CREATE POLICY "Procurement attachment read"
ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='procurement-attachments'
  AND (
    -- Uploader may review their own staged document before linking it.
    ((storage.foldername(name))[2] = auth.uid()::text
      AND (storage.foldername(name))[1] = (
        SELECT p.company_id::text FROM public.profiles p
        WHERE p.id=auth.uid() AND p.is_active
      ))
    OR public.can_read_procurement_attachment(name)
  )
);

-- Verify the uploaded object is from the actor's own company/user folder.
-- Cannot claim another staff member's document by guessing its path.
CREATE OR REPLACE FUNCTION public.procurement_attachment_owned(
  _path text, _company uuid, _actor uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
  SELECT _path IS NOT NULL
    AND split_part(_path,'/',1)=_company::text
    AND split_part(_path,'/',2)=_actor::text
    AND EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.bucket_id='procurement-attachments' AND o.name=_path
    );
$$;
REVOKE ALL ON FUNCTION public.procurement_attachment_owned(text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.procurement_attachment_owned(text,uuid,uuid) TO authenticated;

-- Called after save_purchase_request returns its document ID. A pending PR
-- can receive its FIRST attachment only; subsequent changes require a draft.
-- Existing PR approval, quantities, status and cost remain untouched.
CREATE OR REPLACE FUNCTION public.set_purchase_request_attachment(
  _id uuid, _path text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  request public.purchase_requests%ROWTYPE;
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor)
     OR NOT public.has_permission(actor,'purchase_request.edit') THEN
    RAISE EXCEPTION 'No permission to attach documents to purchase requests';
  END IF;

  SELECT * INTO request FROM public.purchase_requests
  WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR request.requested_by IS DISTINCT FROM actor
     OR NOT public.actor_in_company(request.company_id)
     OR NOT public.can_access_project(actor,request.project_id) THEN
    RAISE EXCEPTION 'Purchase request is not accessible';
  END IF;

  IF request.attachment_path IS NOT DISTINCT FROM _path THEN RETURN; END IF;
  IF request.status NOT IN ('draft','pending_approval')
     OR (request.status='pending_approval' AND request.attachment_path IS NOT NULL) THEN
    RAISE EXCEPTION 'Attachment changes are locked after submission';
  END IF;

  IF _path IS NOT NULL
     AND NOT public.procurement_attachment_owned(_path,request.company_id,actor) THEN
    RAISE EXCEPTION 'Upload a PDF or image belonging to this account first';
  END IF;

  UPDATE public.purchase_requests SET attachment_path=_path WHERE id=_id;
END $$;
REVOKE ALL ON FUNCTION public.set_purchase_request_attachment(uuid,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_purchase_request_attachment(uuid,text)
  TO authenticated;

-- Supplier quotation evidence must be owned by the quote recorder's account.
-- This trigger runs only when the path is newly linked or replaced.
CREATE OR REPLACE FUNCTION public.validate_vendor_quotation_attachment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  company uuid;
BEGIN
  IF NEW.attachment_path IS NULL OR (
    TG_OP='UPDATE' AND NEW.attachment_path IS NOT DISTINCT FROM OLD.attachment_path
  ) THEN RETURN NEW; END IF;
  SELECT r.company_id INTO company FROM public.rfqs r WHERE r.id=NEW.rfq_id;
  IF company IS NULL
     OR NOT public.actor_in_company(company)
     OR NOT public.can_access_project(auth.uid(),(
       SELECT r.project_id FROM public.rfqs r WHERE r.id=NEW.rfq_id
     ))
     OR NOT public.procurement_attachment_owned(NEW.attachment_path,company,auth.uid()) THEN
    RAISE EXCEPTION 'Quotation attachment must be uploaded by this account';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vendor_quotation_attachment_guard ON public.vendor_quotations;
CREATE TRIGGER vendor_quotation_attachment_guard
BEFORE INSERT OR UPDATE OF attachment_path ON public.vendor_quotations
FOR EACH ROW EXECUTE FUNCTION public.validate_vendor_quotation_attachment();
