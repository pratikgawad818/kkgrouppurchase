-- Google OAuth and controlled spreadsheet import queue. Requires 0055.
-- Credentials remain server-side and encrypted at rest with application encryption key.
ALTER TABLE public.erp_google_sheet_connections
  ADD COLUMN oauth_refresh_token_ciphertext text,
  ADD COLUMN oauth_account_email text;
CREATE TABLE public.erp_google_oauth_states (
  state_hash text PRIMARY KEY CHECK (length(state_hash)=64),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  spreadsheet_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.erp_google_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_google_oauth_states FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.erp_google_oauth_states TO service_role;
CREATE INDEX erp_google_oauth_states_expires ON public.erp_google_oauth_states(expires_at);

CREATE TABLE public.erp_sheet_import_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('costing','challan','invoice')),
  source_reference text NOT NULL CHECK (char_length(source_reference) BETWEEN 2 AND 100),
  source_hash text NOT NULL CHECK (char_length(source_hash)=64),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready','applied','conflict','error')),
  error_message text,
  erp_record_id uuid,
  applied_by uuid REFERENCES public.profiles(id),
  applied_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,document_type,source_reference)
);
CREATE INDEX erp_sheet_import_queue_idx ON public.erp_sheet_import_documents(company_id,status,created_at);
ALTER TABLE public.erp_sheet_import_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_sheet_import_documents FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.erp_sheet_import_documents TO service_role;
GRANT SELECT ON public.erp_sheet_import_documents TO authenticated;
CREATE POLICY erp_sheet_queue_super_admin_read ON public.erp_sheet_import_documents
 FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'super_admin')
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
    AND p.company_id=erp_sheet_import_documents.company_id AND p.is_active)
 );

-- A separate historic-cost register: does NOT create a cash payment, payable,
-- stock movement, journal posting, or silently alter approved financial figures.
CREATE TABLE public.erp_project_cost_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  sheet_import_id uuid NOT NULL UNIQUE REFERENCES public.erp_sheet_import_documents(id),
  source_reference text NOT NULL,
  spent_on date NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id),
  building_id uuid REFERENCES public.buildings(id),
  category text NOT NULL,
  vendor_id uuid REFERENCES public.vendors(id),
  description text NOT NULL,
  quantity numeric(15,3),
  unit_rate numeric(18,2),
  amount numeric(18,2) NOT NULL CHECK(amount > 0),
  related_document text,
  payment_method text,
  remarks text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,source_reference)
);
CREATE INDEX erp_project_cost_entries_project_idx ON public.erp_project_cost_entries(company_id,project_id,building_id);
ALTER TABLE public.erp_project_cost_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_project_cost_entries FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.erp_project_cost_entries TO service_role;
GRANT SELECT ON public.erp_project_cost_entries TO authenticated;
CREATE POLICY erp_project_cost_entries_finance_read ON public.erp_project_cost_entries
 FOR SELECT TO authenticated USING (
  public.actor_in_company(company_id) AND public.has_permission(auth.uid(),'financial.view')
  AND public.can_access_project(auth.uid(),project_id)
 );
CREATE OR REPLACE FUNCTION public.erp_project_cost_scope_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id=NEW.project_id AND p.company_id=NEW.company_id)
 THEN RAISE EXCEPTION 'Project does not belong to company'; END IF;
 IF NEW.building_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.buildings b WHERE b.id=NEW.building_id AND b.project_id=NEW.project_id
 ) THEN RAISE EXCEPTION 'Building does not belong to project'; END IF;
 IF NEW.vendor_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.vendors v WHERE v.id=NEW.vendor_id AND v.company_id=NEW.company_id
 ) THEN RAISE EXCEPTION 'Vendor does not belong to company'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER erp_project_cost_scope_guard BEFORE INSERT
  ON public.erp_project_cost_entries FOR EACH ROW EXECUTE FUNCTION public.erp_project_cost_scope_guard();
-- Records are append-only: corrections require an explicit reconciliation workflow.
CREATE OR REPLACE FUNCTION public.erp_project_cost_immutable() RETURNS trigger
 LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Imported project costs are immutable. Reconcile using a controlled adjustment.'; END $$;
CREATE TRIGGER erp_project_cost_immutable BEFORE UPDATE OR DELETE
  ON public.erp_project_cost_entries FOR EACH ROW EXECUTE FUNCTION public.erp_project_cost_immutable();
