ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_type text,
  ADD COLUMN IF NOT EXISTS budget numeric(18,2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  ADD COLUMN IF NOT EXISTS estimated_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
  ADD COLUMN IF NOT EXISTS site_engineer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE TABLE public.project_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name text NOT NULL,
  address text,
  contact_name text,
  contact_phone text,
  status public.record_status NOT NULL DEFAULT 'active',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_sites TO authenticated;
GRANT ALL ON public.project_sites TO service_role;
ALTER TABLE public.project_sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View accessible project sites" ON public.project_sites FOR SELECT TO authenticated USING (public.can_access_project(auth.uid(), project_id));
CREATE POLICY "Manage accessible project sites" ON public.project_sites FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'projects.manage') AND public.can_access_project(auth.uid(), project_id)) WITH CHECK (public.has_permission(auth.uid(),'projects.manage') AND public.can_access_project(auth.uid(), project_id));

CREATE TABLE public.vendor_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  status public.record_status NOT NULL DEFAULT 'active',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_categories TO authenticated;
GRANT ALL ON public.vendor_categories TO service_role;
ALTER TABLE public.vendor_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Active staff view vendor categories" ON public.vendor_categories FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "Vendor managers manage categories" ON public.vendor_categories FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'vendors.manage')) WITH CHECK (public.has_permission(auth.uid(),'vendors.manage'));

CREATE TABLE public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,24}$'),
  company_name text NOT NULL,
  contact_person text,
  mobile text,
  email text,
  address text,
  city text,
  state text,
  pincode text CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$'),
  gstin text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'),
  pan text CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  bank_account_name text,
  bank_name text,
  bank_account_number text,
  ifsc text CHECK (ifsc IS NULL OR ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
  status public.record_status NOT NULL DEFAULT 'active',
  approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('draft','pending_approval','approved','rejected','on_hold')),
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  UNIQUE (company_id, gstin)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO authenticated;
GRANT ALL ON public.vendors TO service_role;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized staff view vendors" ON public.vendors FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'vendors.view'));
CREATE POLICY "Vendor managers create vendors" ON public.vendors FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'vendors.manage'));
CREATE POLICY "Vendor managers update vendors" ON public.vendors FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'vendors.manage')) WITH CHECK (public.has_permission(auth.uid(),'vendors.manage'));
CREATE POLICY "Vendor managers delete vendors" ON public.vendors FOR DELETE TO authenticated USING (public.has_permission(auth.uid(),'vendors.manage'));

CREATE TABLE public.vendor_category_links (
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.vendor_categories(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_id, category_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_category_links TO authenticated;
GRANT ALL ON public.vendor_category_links TO service_role;
ALTER TABLE public.vendor_category_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized staff view vendor classifications" ON public.vendor_category_links FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'vendors.view'));
CREATE POLICY "Vendor managers manage classifications" ON public.vendor_category_links FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'vendors.manage')) WITH CHECK (public.has_permission(auth.uid(),'vendors.manage'));

CREATE TABLE public.units_of_measure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,12}$'),
  name text NOT NULL,
  decimal_places smallint NOT NULL DEFAULT 2 CHECK (decimal_places BETWEEN 0 AND 4),
  status public.record_status NOT NULL DEFAULT 'active',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.units_of_measure TO authenticated;
GRANT ALL ON public.units_of_measure TO service_role;
ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized staff view units of measure" ON public.units_of_measure FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'materials.view'));
CREATE POLICY "Material managers manage units of measure" ON public.units_of_measure FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'materials.manage')) WITH CHECK (public.has_permission(auth.uid(),'materials.manage'));

CREATE TABLE public.item_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  parent_id uuid REFERENCES public.item_categories(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name text NOT NULL,
  description text,
  status public.record_status NOT NULL DEFAULT 'active',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  UNIQUE (company_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_categories TO authenticated;
GRANT ALL ON public.item_categories TO service_role;
ALTER TABLE public.item_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized staff view item categories" ON public.item_categories FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'materials.view'));
CREATE POLICY "Material managers manage categories" ON public.item_categories FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'materials.manage')) WITH CHECK (public.has_permission(auth.uid(),'materials.manage'));

CREATE TABLE public.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,24}$'),
  name text NOT NULL,
  category_id uuid NOT NULL REFERENCES public.item_categories(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES public.units_of_measure(id) ON DELETE RESTRICT,
  description text,
  specification text,
  hsn_sac text,
  minimum_stock numeric(18,3) NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  reorder_level numeric(18,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  maximum_stock numeric(18,3) CHECK (maximum_stock IS NULL OR maximum_stock >= 0),
  preferred_vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  status public.record_status NOT NULL DEFAULT 'active',
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  CHECK (maximum_stock IS NULL OR maximum_stock >= reorder_level),
  CHECK (reorder_level >= minimum_stock)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.items TO authenticated;
GRANT ALL ON public.items TO service_role;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized staff view materials" ON public.items FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'materials.view'));
CREATE POLICY "Material managers create materials" ON public.items FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'materials.manage'));
CREATE POLICY "Material managers update materials" ON public.items FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'materials.manage')) WITH CHECK (public.has_permission(auth.uid(),'materials.manage'));
CREATE POLICY "Material managers delete materials" ON public.items FOR DELETE TO authenticated USING (public.has_permission(auth.uid(),'materials.manage'));

CREATE TABLE public.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT,
  site_id uuid REFERENCES public.project_sites(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,24}$'),
  name text NOT NULL,
  warehouse_type text NOT NULL CHECK (warehouse_type IN ('main','project','site','other')),
  address text,
  contact_name text,
  contact_phone text,
  responsible_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.record_status NOT NULL DEFAULT 'active',
  is_demo boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  CHECK (site_id IS NULL OR project_id IS NOT NULL)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouses TO authenticated;
GRANT ALL ON public.warehouses TO service_role;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authorized staff view warehouses" ON public.warehouses FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'warehouses.view') AND (project_id IS NULL OR public.can_access_project(auth.uid(), project_id)));
CREATE POLICY "Warehouse managers create warehouses" ON public.warehouses FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'warehouses.manage') AND (project_id IS NULL OR public.can_access_project(auth.uid(), project_id)));
CREATE POLICY "Warehouse managers update warehouses" ON public.warehouses FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'warehouses.manage') AND (project_id IS NULL OR public.can_access_project(auth.uid(), project_id))) WITH CHECK (public.has_permission(auth.uid(),'warehouses.manage') AND (project_id IS NULL OR public.can_access_project(auth.uid(), project_id)));
CREATE POLICY "Warehouse managers delete warehouses" ON public.warehouses FOR DELETE TO authenticated USING (public.has_permission(auth.uid(),'warehouses.manage') AND (project_id IS NULL OR public.can_access_project(auth.uid(), project_id)));

CREATE INDEX project_sites_project_idx ON public.project_sites(project_id);
CREATE INDEX vendors_name_idx ON public.vendors(company_id, company_name);
CREATE INDEX vendors_status_idx ON public.vendors(company_id, status);
CREATE INDEX vendor_category_links_category_idx ON public.vendor_category_links(category_id);
CREATE INDEX item_categories_parent_idx ON public.item_categories(parent_id);
CREATE INDEX items_name_idx ON public.items(company_id, name);
CREATE INDEX items_category_idx ON public.items(category_id);
CREATE INDEX items_status_idx ON public.items(company_id, status);
CREATE INDEX warehouses_project_idx ON public.warehouses(project_id);
CREATE INDEX warehouses_site_idx ON public.warehouses(site_id);

CREATE TRIGGER touch_project_sites BEFORE UPDATE ON public.project_sites FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_vendor_categories BEFORE UPDATE ON public.vendor_categories FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_vendors BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_units_of_measure BEFORE UPDATE ON public.units_of_measure FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_item_categories BEFORE UPDATE ON public.item_categories FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_items BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_warehouses BEFORE UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER audit_project_sites AFTER INSERT OR UPDATE OR DELETE ON public.project_sites FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_vendor_categories AFTER INSERT OR UPDATE OR DELETE ON public.vendor_categories FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_vendors AFTER INSERT OR UPDATE OR DELETE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_vendor_category_links AFTER INSERT OR UPDATE OR DELETE ON public.vendor_category_links FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_units_of_measure AFTER INSERT OR UPDATE OR DELETE ON public.units_of_measure FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_item_categories AFTER INSERT OR UPDATE OR DELETE ON public.item_categories FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_items AFTER INSERT OR UPDATE OR DELETE ON public.items FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_warehouses AFTER INSERT OR UPDATE OR DELETE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.audit_row();