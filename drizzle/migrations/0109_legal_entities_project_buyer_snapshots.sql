-- 0109: KK Group is one ERP tenant containing several *distinct legal buyers*.
-- The companies table remains the workspace/tenant, not a GST registration.
-- Project → legal entity is explicit. POs freeze their buyer identity at INSERT.
-- Historical PRs/POs/GRNs/invoices and all accounting transactions are untouched.
-- Missing/unknown GSTINs are deliberately NULL; no fictitious GST numbers.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS legal_entity_mode boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.legal_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code text NOT NULL,
  display_name text NOT NULL,
  legal_name text,
  gstin text,
  pan text,
  registered_address text,
  office_address text,
  phone text,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_entities_code_unique UNIQUE(company_id,code),
  CONSTRAINT legal_entities_gstin_format CHECK (
    gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'
  ),
  CONSTRAINT legal_entities_nonblank_name CHECK (length(trim(display_name))>0)
);
CREATE INDEX IF NOT EXISTS legal_entities_tenant_idx ON public.legal_entities(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS legal_entities_one_registration_per_tenant
  ON public.legal_entities(company_id,gstin) WHERE gstin IS NOT NULL;
ALTER TABLE public.legal_entities ENABLE ROW LEVEL SECURITY;
-- PostgreSQL table privileges and RLS are separate; missing GRANT would
-- make even authorized Super Admin unable to load or edit these profiles.
GRANT SELECT,INSERT,UPDATE ON public.legal_entities TO authenticated;
REVOKE DELETE ON public.legal_entities FROM PUBLIC,anon,authenticated;

DROP POLICY IF EXISTS "Company staff view legal entities" ON public.legal_entities;
CREATE POLICY "Company staff view legal entities" ON public.legal_entities
  FOR SELECT TO authenticated USING (public.actor_in_company(company_id));
DROP POLICY IF EXISTS "Super Admin creates legal entities" ON public.legal_entities;
CREATE POLICY "Super Admin creates legal entities" ON public.legal_entities
  FOR INSERT TO authenticated WITH CHECK (
    public.actor_in_company(company_id)
    AND public.has_role(auth.uid(),'super_admin')
    AND public.has_permission(auth.uid(),'company.manage')
  );
DROP POLICY IF EXISTS "Super Admin updates legal entities" ON public.legal_entities;
CREATE POLICY "Super Admin updates legal entities" ON public.legal_entities
  FOR UPDATE TO authenticated USING (
    public.actor_in_company(company_id)
    AND public.has_role(auth.uid(),'super_admin')
    AND public.has_permission(auth.uid(),'company.manage')
  ) WITH CHECK (
    public.actor_in_company(company_id)
    AND public.has_role(auth.uid(),'super_admin')
    AND public.has_permission(auth.uid(),'company.manage')
  );
-- There is deliberately no DELETE policy: deactivate instead, keeping mapping.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.legal_entities(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS projects_legal_entity_idx
  ON public.projects(legal_entity_id);

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS buyer_legal_entity_id uuid REFERENCES public.legal_entities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS buyer_legal_name text,
  ADD COLUMN IF NOT EXISTS buyer_gstin text,
  ADD COLUMN IF NOT EXISTS buyer_pan text,
  ADD COLUMN IF NOT EXISTS buyer_registered_address text,
  ADD COLUMN IF NOT EXISTS buyer_phone text,
  ADD COLUMN IF NOT EXISTS buyer_email text;
CREATE INDEX IF NOT EXISTS purchase_orders_buyer_entity_idx
  ON public.purchase_orders(company_id,buyer_legal_entity_id);

-- Seed ONLY the current confirmed workspace. Existing K.K. Construction legal
-- identifiers come from its verified company master. Kanesa and KK Infra
-- remain incomplete until their official GSTIN/legal details are supplied.
INSERT INTO public.legal_entities(
  company_id,code,display_name,legal_name,gstin,pan,
  registered_address,office_address,phone,email
)
SELECT c.id,'KKCON','K.K. Construction',c.legal_name,c.gstin,c.pan,
       c.registered_address,c.office_address,c.phone,c.email
FROM public.companies c WHERE c.gstin='27AALFK3094R1ZG'
ON CONFLICT (company_id,code) DO NOTHING;

INSERT INTO public.legal_entities(company_id,code,display_name)
SELECT c.id,'KANESA','Kanesa Edifice'
FROM public.companies c WHERE c.gstin='27AALFK3094R1ZG'
ON CONFLICT (company_id,code) DO NOTHING;

INSERT INTO public.legal_entities(company_id,code,display_name)
SELECT c.id,'KKINFRA','KK Infra'
FROM public.companies c WHERE c.gstin='27AALFK3094R1ZG'
ON CONFLICT (company_id,code) DO NOTHING;

-- User-confirmed mappings; leave Central Hub and Supreme Park unassigned.
-- Navali does not exist yet in this ERP project master: DO NOT silently
-- rename Central Hub or create a second/duplicate project.
UPDATE public.projects p SET legal_entity_id=e.id
FROM public.legal_entities e
WHERE p.company_id=e.company_id AND e.code='KANESA'
  AND p.code='CC' AND p.name='City Centre'
  AND e.company_id IN (SELECT id FROM public.companies WHERE gstin='27AALFK3094R1ZG')
  AND p.legal_entity_id IS DISTINCT FROM e.id;
UPDATE public.projects p SET legal_entity_id=e.id
FROM public.legal_entities e
WHERE p.company_id=e.company_id AND e.code='KKCON'
  AND ((p.code='KKP' AND p.name='KK Park')
    OR (p.code='CP-2' AND p.name='Crescent Point-II'))
  AND e.company_id IN (SELECT id FROM public.companies WHERE gstin='27AALFK3094R1ZG')
  AND p.legal_entity_id IS DISTINCT FROM e.id;
UPDATE public.companies SET legal_entity_mode=true
  WHERE gstin='27AALFK3094R1ZG';

-- Protect project assignments even from someone allowed to edit project
-- dates/budgets. Changing the legal buyer is Super Admin only.
CREATE OR REPLACE FUNCTION public.guard_project_legal_entity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public','pg_temp' AS $function$
DECLARE tenant uuid;
BEGIN
  IF NEW.legal_entity_id IS NOT NULL THEN
    SELECT company_id INTO tenant FROM public.legal_entities
      WHERE id=NEW.legal_entity_id;
    IF tenant IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Legal entity must belong to the project company';
    END IF;
  END IF;
  IF (TG_OP='INSERT' AND NEW.legal_entity_id IS NOT NULL)
    OR (TG_OP='UPDATE'
      AND NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id) THEN
    IF NOT public.has_role(auth.uid(),'super_admin')
       OR NOT public.has_permission(auth.uid(),'company.manage') THEN
      RAISE EXCEPTION 'Only Super Admin can change a project legal entity';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS guard_project_legal_entity_update ON public.projects;
CREATE TRIGGER guard_project_legal_entity_update
BEFORE INSERT OR UPDATE OF legal_entity_id,company_id ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.guard_project_legal_entity();

-- Snapshot official buyer fields at the actual moment a new PO is created,
-- never when somebody later prints an older document. Fail closed if a
-- mapped project has an unverified/missing GSTIN or address.
CREATE OR REPLACE FUNCTION public.snapshot_po_legal_buyer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
DECLARE entity public.legal_entities%ROWTYPE;
  project_tenant uuid;
  selected_entity uuid;
  enforce_mode boolean;
BEGIN
  SELECT legal_entity_mode INTO enforce_mode FROM public.companies
  WHERE id=NEW.company_id;
  IF NOT coalesce(enforce_mode,false) THEN RETURN NEW; END IF;
  SELECT p.company_id,p.legal_entity_id INTO project_tenant,selected_entity
    FROM public.projects p WHERE p.id=NEW.project_id;
  IF project_tenant IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'PO project does not belong to this ERP workspace';
  END IF;
  IF selected_entity IS NULL THEN
    RAISE EXCEPTION 'Assign this project to a legal entity in Company Settings before creating a PO';
  END IF;
  SELECT * INTO entity FROM public.legal_entities
    WHERE id=selected_entity AND company_id=NEW.company_id;
  IF entity.id IS NULL OR NOT entity.is_active THEN
    RAISE EXCEPTION 'Project legal entity is inactive or not available';
  END IF;
  IF nullif(btrim(coalesce(entity.legal_name,'')),'') IS NULL
    OR nullif(btrim(coalesce(entity.gstin,'')),'') IS NULL
    OR nullif(btrim(coalesce(entity.registered_address,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Complete legal name, GSTIN and registered address for % in Company Settings before creating a PO',
      entity.display_name;
  END IF;
  NEW.buyer_legal_entity_id:=entity.id;
  NEW.buyer_legal_name:=entity.legal_name;
  NEW.buyer_gstin:=entity.gstin;
  NEW.buyer_pan:=entity.pan;
  NEW.buyer_registered_address:=entity.registered_address;
  NEW.buyer_phone:=entity.phone;
  NEW.buyer_email:=entity.email;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS snapshot_po_legal_buyer_insert ON public.purchase_orders;
CREATE TRIGGER snapshot_po_legal_buyer_insert
BEFORE INSERT ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.snapshot_po_legal_buyer();

-- Never silently change an issued buyer by editing the project or entity
-- master. Corrections require a formal document revision workflow.
CREATE OR REPLACE FUNCTION public.guard_po_buyer_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  IF (NEW.buyer_legal_entity_id,NEW.buyer_legal_name,NEW.buyer_gstin,
      NEW.buyer_pan,NEW.buyer_registered_address,NEW.buyer_phone,NEW.buyer_email)
    IS DISTINCT FROM
     (OLD.buyer_legal_entity_id,OLD.buyer_legal_name,OLD.buyer_gstin,
      OLD.buyer_pan,OLD.buyer_registered_address,OLD.buyer_phone,OLD.buyer_email)
  THEN RAISE EXCEPTION 'PO buyer identity is immutable; issue a documented correction'; END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS guard_po_buyer_snapshot_update ON public.purchase_orders;
CREATE TRIGGER guard_po_buyer_snapshot_update
BEFORE UPDATE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.guard_po_buyer_snapshot();

REVOKE ALL ON FUNCTION public.snapshot_po_legal_buyer() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_po_buyer_snapshot() FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE public.legal_entities IS
'GST/legal buyers inside a single KK GROUP ERP tenant. Does not replace companies tenant_id or company_id accounting isolation; broader legal-entity ledger segregation is a separate controlled rollout.';
