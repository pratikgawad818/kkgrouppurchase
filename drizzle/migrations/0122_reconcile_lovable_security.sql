-- Restore invite-only access and record the invoice attachment guard previously
-- installed directly in production by Lovable. No historical rows are rewritten.
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS public.profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE p public.profiles%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
 IF NOT FOUND OR NOT p.is_active OR p.company_id IS NULL
 OR NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id) THEN
 RAISE EXCEPTION 'Staff access has not been enabled. Contact your administrator.' USING ERRCODE='42501';
 END IF;
 RETURN p;
END $$;
REVOKE ALL ON FUNCTION public.ensure_profile() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;
ALTER TABLE public.profiles ALTER COLUMN is_active SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_vendor_invoice_attachment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
BEGIN
 IF NEW.attachment_path IS NULL OR (TG_OP='UPDATE' AND NEW.attachment_path IS NOT DISTINCT FROM OLD.attachment_path) THEN
   RETURN NEW;
 END IF;
 IF auth.uid() IS NULL THEN
   IF auth.role() IN ('authenticated','anon') THEN
     RAISE EXCEPTION 'Sign in before attaching an invoice file' USING ERRCODE='42501';
   END IF;
   RETURN NEW;
 END IF;
 IF NOT public.actor_in_company(NEW.company_id)
    OR NEW.attachment_path !~ '^invoices/[0-9a-fA-F-]{36}-[A-Za-z0-9._-]+$'
    OR NOT EXISTS (SELECT 1 FROM storage.objects o
      WHERE o.bucket_id='vendor-documents' AND o.name=NEW.attachment_path
      AND o.owner_id=auth.uid()::text) THEN
   RAISE EXCEPTION 'Attachment must be an invoice file you uploaded.' USING ERRCODE='42501';
 END IF;
 -- Serialize invoice claims for the same path; unchanged attachments remain valid.
 PERFORM pg_advisory_xact_lock(hashtextextended('vendor-document:'||NEW.attachment_path,0));
 IF EXISTS (SELECT 1 FROM public.vendor_invoices v WHERE v.attachment_path=NEW.attachment_path AND v.id<>NEW.id)
    OR EXISTS (SELECT 1 FROM public.vendor_payments p WHERE p.proof_path=NEW.attachment_path) THEN
   RAISE EXCEPTION 'This file is already attached to another document.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_vendor_invoice_attachment() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_guard_vendor_invoice_attachment ON public.vendor_invoices;
CREATE TRIGGER trg_guard_vendor_invoice_attachment BEFORE INSERT OR UPDATE OF attachment_path ON public.vendor_invoices
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_invoice_attachment();
