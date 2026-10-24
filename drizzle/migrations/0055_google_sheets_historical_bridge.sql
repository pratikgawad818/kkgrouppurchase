-- Google Sheets is an external editing surface, not an alternate stock/finance ledger.
-- No spreadsheet may post GRNs, material issues, approvals or payments directly.
CREATE TABLE public.erp_google_sheet_connections (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  spreadsheet_id text NOT NULL CHECK (spreadsheet_id ~ '^[A-Za-z0-9_-]{25,}$'),
  spreadsheet_title text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  last_error text,
  last_result jsonb,
  sync_lease_until timestamptz,
  configured_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.erp_historical_material_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  reference text NOT NULL CHECK (reference ~ '^[A-Z0-9_-]{2,64}$'),
  occurred_on date NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  building_id uuid REFERENCES public.buildings(id) ON DELETE RESTRICT,
  material_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  quantity numeric(15,3) NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  unit_cost numeric(18,2) NOT NULL CHECK (unit_cost >= 0),
  purpose text NOT NULL DEFAULT '',
  last_synced_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, reference)
);
CREATE INDEX erp_historical_material_consumptions_scope
 ON public.erp_historical_material_consumptions(company_id,project_id,building_id,material_id);
ALTER TABLE public.erp_google_sheet_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_historical_material_consumptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_google_sheet_connections FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.erp_historical_material_consumptions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.erp_google_sheet_connections TO service_role;
GRANT ALL ON public.erp_historical_material_consumptions TO service_role;
GRANT SELECT ON public.erp_historical_material_consumptions TO authenticated;
CREATE POLICY erp_historical_consumption_read ON public.erp_historical_material_consumptions
 FOR SELECT TO authenticated USING (
   EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
     AND p.company_id=erp_historical_material_consumptions.company_id AND p.is_active)
   AND public.has_permission(auth.uid(),'inventory.view')
 );
-- Tenant and building/material ownership must also be enforced by server imports.
-- Historical quantities do not touch inventory_transactions or warehouse_stock.

-- Import integrity is also verified in the database, not only in the app.
CREATE FUNCTION public.erp_validate_historical_consumption() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p JOIN public.items i ON i.company_id=p.company_id
    WHERE p.id=NEW.project_id AND p.company_id=NEW.company_id AND i.id=NEW.material_id
  ) THEN RAISE EXCEPTION 'Historical material must belong to the selected company and project'; END IF;
  IF NEW.building_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.buildings b WHERE b.id=NEW.building_id AND b.project_id=NEW.project_id
  ) THEN RAISE EXCEPTION 'Historical building must belong to the selected project'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.erp_validate_historical_consumption() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER erp_historical_scope_guard BEFORE INSERT OR UPDATE
  ON public.erp_historical_material_consumptions FOR EACH ROW
  EXECUTE FUNCTION public.erp_validate_historical_consumption();

-- Append-only logical history captures imports and corrections made through Sheets.
CREATE TABLE public.erp_google_sheet_import_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  reference text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE')),
  previous_row jsonb,
  new_row jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_google_sheet_import_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_google_sheet_import_audit FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.erp_google_sheet_import_audit TO service_role;
CREATE FUNCTION public.erp_audit_historical_consumption() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO public.erp_google_sheet_import_audit(company_id,reference,operation,previous_row,new_row)
  VALUES(NEW.company_id,NEW.reference,TG_OP,
    CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.erp_audit_historical_consumption() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER erp_historical_audit AFTER INSERT OR UPDATE OF reference,occurred_on,project_id,building_id,material_id,quantity,unit_cost,purpose
  ON public.erp_historical_material_consumptions FOR EACH ROW
  EXECUTE FUNCTION public.erp_audit_historical_consumption();
