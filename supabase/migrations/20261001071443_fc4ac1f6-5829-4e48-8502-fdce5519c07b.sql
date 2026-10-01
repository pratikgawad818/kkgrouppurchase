-- ================= ENUMS =================
CREATE TYPE public.app_role AS ENUM ('super_admin','director','sales_manager','sales_executive','accounts_manager','purchase_manager','site_engineer','project_manager','accountant');
CREATE TYPE public.project_status AS ENUM ('planning','approval','under_construction','near_completion','completed','on_hold','cancelled');
CREATE TYPE public.work_status AS ENUM ('not_started','in_progress','on_hold','completed');
CREATE TYPE public.unit_type AS ENUM ('1bhk','2bhk','3bhk','4bhk','shop','office','other');
CREATE TYPE public.unit_status AS ENUM ('available','hold','booked','agreement_pending','agreement_done','registered','possession_pending','possession_completed','cancelled');
CREATE TYPE public.record_status AS ENUM ('active','inactive');

-- ================= COMMON =================
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ================= COMPANY =================
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  logo_url text,
  registered_address text,
  office_address text,
  phone text,
  email text,
  pan text CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  tan text CHECK (tan IS NULL OR tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  gstin text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'),
  cin text,
  rera_promoter_id text,
  rera_details text,
  fy_start_month smallint NOT NULL DEFAULT 4 CHECK (fy_start_month BETWEEN 1 AND 12),
  invoice_prefix text NOT NULL DEFAULT 'INV',
  receipt_prefix text NOT NULL DEFAULT 'RCT',
  booking_prefix text NOT NULL DEFAULT 'BKG',
  invoice_terms text,
  gst_rate_residential numeric(5,2) NOT NULL DEFAULT 5 CHECK (gst_rate_residential >= 0),
  gst_rate_commercial numeric(5,2) NOT NULL DEFAULT 12 CHECK (gst_rate_commercial >= 0),
  tds_property_rate numeric(5,2) NOT NULL DEFAULT 1 CHECK (tds_property_rate >= 0),
  notification_settings jsonb NOT NULL DEFAULT '{"payment_due_days_before":7,"email_alerts":true,"sms_alerts":false}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.company_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  account_name text NOT NULL,
  bank_name text NOT NULL,
  branch text,
  account_number text NOT NULL,
  ifsc text NOT NULL CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  account_type text NOT NULL DEFAULT 'current',
  purpose text,
  is_primary boolean NOT NULL DEFAULT false,
  status public.record_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, account_number)
);

CREATE TABLE public.financial_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  label text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date > start_date),
  UNIQUE (company_id, label)
);
CREATE UNIQUE INDEX financial_periods_one_current ON public.financial_periods(company_id) WHERE is_current;

-- ================= USERS / RBAC =================
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  full_name text,
  email text,
  phone text,
  designation text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE public.permissions (
  code text PRIMARY KEY,
  module text NOT NULL,
  description text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE public.role_permissions (
  role public.app_role NOT NULL,
  permission_code text NOT NULL REFERENCES public.permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role, permission_code)
);

-- ================= RBAC FUNCTIONS =================
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
                 WHERE ur.user_id = _user_id AND ur.role = _role AND p.is_active)
$$;

CREATE OR REPLACE FUNCTION public.is_active_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND is_active)
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id AND p.is_active
    LEFT JOIN public.role_permissions rp ON rp.role = ur.role AND rp.permission_code = _code
    WHERE ur.user_id = _user_id AND (ur.role = 'super_admin' OR rp.permission_code IS NOT NULL)
  )
$$;

CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT p.code FROM public.permissions p WHERE public.has_permission(auth.uid(), p.code)
$$;

-- ================= PROJECTS =================
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name text NOT NULL,
  location text,
  address text,
  city text,
  state text,
  pincode text CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$'),
  land_area_sqm numeric(14,2) CHECK (land_area_sqm IS NULL OR land_area_sqm >= 0),
  development_area_sqft numeric(14,2) CHECK (development_area_sqft IS NULL OR development_area_sqft >= 0),
  start_date date,
  expected_completion_date date,
  actual_completion_date date,
  status public.project_status NOT NULL DEFAULT 'planning',
  developer_details text,
  architect text,
  structural_consultant text,
  project_manager_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rera_number text,
  rera_registration_date date,
  rera_valid_until date,
  description text,
  record_status public.record_status NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  CHECK (expected_completion_date IS NULL OR start_date IS NULL OR expected_completion_date >= start_date),
  CHECK (rera_valid_until IS NULL OR rera_registration_date IS NULL OR rera_valid_until >= rera_registration_date)
);

CREATE TABLE public.user_project_assignments (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

CREATE OR REPLACE FUNCTION public.can_access_project(_user_id uuid, _project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_permission(_user_id, 'projects.view_all')
      OR (public.is_active_user(_user_id) AND EXISTS (SELECT 1 FROM public.user_project_assignments WHERE user_id = _user_id AND project_id = _project_id))
$$;

CREATE TABLE public.buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  wing text,
  planned_floors int NOT NULL DEFAULT 0 CHECK (planned_floors >= 0),
  ground_floor_config text,
  construction_start date,
  expected_completion date,
  actual_completion date,
  progress_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  budget numeric(16,2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  status public.work_status NOT NULL DEFAULT 'not_started',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
CREATE INDEX ON public.buildings(project_id);

CREATE TABLE public.floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE RESTRICT,
  floor_number int NOT NULL CHECK (floor_number BETWEEN -5 AND 200),
  name text NOT NULL,
  construction_status public.work_status NOT NULL DEFAULT 'not_started',
  completion_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (building_id, floor_number)
);
CREATE INDEX ON public.floors(building_id);

CREATE TABLE public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE RESTRICT,
  floor_id uuid NOT NULL REFERENCES public.floors(id) ON DELETE RESTRICT,
  unit_number text NOT NULL,
  unit_type public.unit_type NOT NULL,
  facing text,
  carpet_area numeric(10,2) NOT NULL CHECK (carpet_area > 0),
  built_up_area numeric(10,2) NOT NULL CHECK (built_up_area > 0),
  saleable_area numeric(10,2) NOT NULL CHECK (saleable_area > 0),
  balcony_area numeric(10,2) NOT NULL DEFAULT 0 CHECK (balcony_area >= 0),
  terrace_area numeric(10,2) NOT NULL DEFAULT 0 CHECK (terrace_area >= 0),
  parking_count int NOT NULL DEFAULT 0 CHECK (parking_count >= 0),
  parking_details text,
  base_rate numeric(12,2) NOT NULL CHECK (base_rate > 0),
  floor_rise_rate numeric(12,2) NOT NULL DEFAULT 0 CHECK (floor_rise_rate >= 0),
  parking_charges numeric(14,2) NOT NULL DEFAULT 0 CHECK (parking_charges >= 0),
  other_charges numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_charges >= 0),
  gst_rate numeric(5,2) NOT NULL DEFAULT 5 CHECK (gst_rate >= 0 AND gst_rate <= 28),
  base_price numeric(16,2) NOT NULL DEFAULT 0,
  floor_rise_amount numeric(16,2) NOT NULL DEFAULT 0,
  taxable_value numeric(16,2) NOT NULL DEFAULT 0,
  gst_amount numeric(16,2) NOT NULL DEFAULT 0,
  total_agreement_value numeric(16,2) NOT NULL DEFAULT 0,
  booking_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (booking_amount >= 0),
  status public.unit_status NOT NULL DEFAULT 'available',
  hold_until timestamptz,
  hold_reason text,
  notes text,
  record_status public.record_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (building_id, unit_number),
  CHECK (carpet_area <= built_up_area AND built_up_area <= saleable_area)
);
CREATE INDEX ON public.units(project_id);
CREATE INDEX ON public.units(building_id);
CREATE INDEX ON public.units(floor_id);
CREATE INDEX ON public.units(status);

CREATE TABLE public.unit_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  from_status public.unit_status,
  to_status public.unit_status NOT NULL,
  reason text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.unit_status_history(unit_id, changed_at DESC);

CREATE TABLE public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.audit_logs(entity, entity_id);
CREATE INDEX ON public.audit_logs(created_at DESC);

-- ================= UNIT BUSINESS RULES =================
CREATE OR REPLACE FUNCTION public.units_before_write() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_building uuid; v_project uuid; v_src text := coalesce(current_setting('app.unit_status_source', true), '');
BEGIN
  SELECT f.building_id, b.project_id INTO v_building, v_project
  FROM public.floors f JOIN public.buildings b ON b.id = f.building_id WHERE f.id = NEW.floor_id;
  IF v_building IS NULL THEN RAISE EXCEPTION 'Selected floor does not exist.'; END IF;
  NEW.building_id := v_building;
  NEW.project_id := v_project;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('available','hold') THEN
      RAISE EXCEPTION 'New units can only be created as Available or Hold.';
    END IF;
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IN ('booked','agreement_pending','agreement_done','registered','possession_pending','possession_completed')
         AND v_src <> 'sales' THEN
        RAISE EXCEPTION 'Unit % can only move to % through a booking record.', OLD.unit_number, NEW.status;
      END IF;
      IF v_src NOT IN ('rpc','sales') THEN
        RAISE EXCEPTION 'Unit status must be changed through the status workflow, not by direct edit.';
      END IF;
    END IF;
    IF OLD.status NOT IN ('available','hold','cancelled') AND (
         NEW.saleable_area IS DISTINCT FROM OLD.saleable_area OR NEW.base_rate IS DISTINCT FROM OLD.base_rate OR
         NEW.floor_rise_rate IS DISTINCT FROM OLD.floor_rise_rate OR NEW.parking_charges IS DISTINCT FROM OLD.parking_charges OR
         NEW.other_charges IS DISTINCT FROM OLD.other_charges OR NEW.gst_rate IS DISTINCT FROM OLD.gst_rate) THEN
      RAISE EXCEPTION 'Pricing for unit % is locked because it has an active booking.', OLD.unit_number;
    END IF;
  END IF;

  IF NEW.status <> 'hold' THEN NEW.hold_until := NULL; NEW.hold_reason := NULL; END IF;

  -- Centralised pricing (numeric, rounded to paise)
  NEW.base_price := round(NEW.saleable_area * NEW.base_rate, 2);
  NEW.floor_rise_amount := round(NEW.saleable_area * NEW.floor_rise_rate, 2);
  NEW.taxable_value := NEW.base_price + NEW.floor_rise_amount + NEW.parking_charges + NEW.other_charges;
  NEW.gst_amount := round(NEW.taxable_value * NEW.gst_rate / 100, 2);
  NEW.total_agreement_value := NEW.taxable_value + NEW.gst_amount;
  IF NEW.booking_amount > NEW.total_agreement_value THEN
    RAISE EXCEPTION 'Booking amount cannot exceed the total agreement value.';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER units_before_write BEFORE INSERT OR UPDATE ON public.units FOR EACH ROW EXECUTE FUNCTION public.units_before_write();

CREATE OR REPLACE FUNCTION public.units_status_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.unit_status_history(unit_id, from_status, to_status, reason, changed_by)
    VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
            coalesce(nullif(current_setting('app.unit_status_reason', true), ''), CASE WHEN TG_OP='INSERT' THEN 'Unit created' END),
            auth.uid());
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER units_status_history AFTER INSERT OR UPDATE ON public.units FOR EACH ROW EXECUTE FUNCTION public.units_status_history();

CREATE OR REPLACE FUNCTION public.set_unit_status(_unit_id uuid, _status public.unit_status, _reason text DEFAULT NULL, _hold_until timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.units%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.units WHERE id = _unit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unit not found.'; END IF;
  IF NOT public.can_access_project(auth.uid(), u.project_id) THEN RAISE EXCEPTION 'You do not have access to this project.'; END IF;
  IF u.status = _status THEN RAISE EXCEPTION 'Unit % is already %.', u.unit_number, _status; END IF;
  IF u.status NOT IN ('available','hold','cancelled') THEN
    RAISE EXCEPTION 'Unit % is %. Its status can only change through its booking.', u.unit_number, u.status;
  END IF;
  IF _status = 'hold' THEN
    IF NOT public.has_permission(auth.uid(), 'units.hold') THEN RAISE EXCEPTION 'You do not have permission to hold units.'; END IF;
    IF u.status <> 'available' THEN RAISE EXCEPTION 'Only available units can be put on hold.'; END IF;
    IF coalesce(trim(_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required to hold a unit.'; END IF;
    IF _hold_until IS NOT NULL AND _hold_until <= now() THEN RAISE EXCEPTION 'Hold expiry must be in the future.'; END IF;
  ELSIF _status = 'available' THEN
    IF NOT (public.has_permission(auth.uid(), 'units.hold') OR public.has_permission(auth.uid(), 'units.manage')) THEN
      RAISE EXCEPTION 'You do not have permission to release units.'; END IF;
    IF u.status = 'cancelled' AND NOT public.has_permission(auth.uid(), 'units.manage') THEN
      RAISE EXCEPTION 'Only inventory managers can restore withdrawn units.'; END IF;
  ELSIF _status = 'cancelled' THEN
    IF NOT public.has_permission(auth.uid(), 'units.manage') THEN RAISE EXCEPTION 'You do not have permission to withdraw units.'; END IF;
    IF coalesce(trim(_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required to withdraw a unit from sale.'; END IF;
  ELSE
    RAISE EXCEPTION 'Unit % can only move to % through a booking record.', u.unit_number, _status;
  END IF;
  PERFORM set_config('app.unit_status_source', 'rpc', true);
  PERFORM set_config('app.unit_status_reason', coalesce(_reason, ''), true);
  UPDATE public.units SET status = _status,
    hold_reason = CASE WHEN _status = 'hold' THEN _reason END,
    hold_until = CASE WHEN _status = 'hold' THEN _hold_until END
  WHERE id = _unit_id;
  PERFORM set_config('app.unit_status_source', '', true);
  PERFORM set_config('app.unit_status_reason', '', true);
END; $$;

-- Bulk structure generator (runs with caller's permissions via RLS)
CREATE OR REPLACE FUNCTION public.generate_units(
  _building_id uuid, _floor_from int, _floor_to int, _units_per_floor int, _unit_type public.unit_type,
  _carpet numeric, _built_up numeric, _saleable numeric, _base_rate numeric,
  _floor_rise_step numeric DEFAULT 0, _parking_charges numeric DEFAULT 0, _other_charges numeric DEFAULT 0,
  _gst_rate numeric DEFAULT 5, _booking_amount numeric DEFAULT 0)
RETURNS int LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE b public.buildings%ROWTYPE; f int; n int; v_floor uuid; v_count int := 0; v_no text;
BEGIN
  IF _floor_to < _floor_from THEN RAISE EXCEPTION 'Floor "to" must be greater than or equal to floor "from".'; END IF;
  IF _units_per_floor < 1 OR _units_per_floor > 50 THEN RAISE EXCEPTION 'Units per floor must be between 1 and 50.'; END IF;
  SELECT * INTO b FROM public.buildings WHERE id = _building_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Building not found or not accessible.'; END IF;
  FOR f IN _floor_from.._floor_to LOOP
    INSERT INTO public.floors(building_id, floor_number, name)
    VALUES (_building_id, f, CASE WHEN f = 0 THEN 'Ground Floor' WHEN f < 0 THEN 'Basement ' || abs(f) ELSE 'Floor ' || f END)
    ON CONFLICT (building_id, floor_number) DO NOTHING;
    SELECT id INTO v_floor FROM public.floors WHERE building_id = _building_id AND floor_number = f;
    FOR n IN 1.._units_per_floor LOOP
      v_no := b.code || '-' || CASE WHEN f = 0 THEN 'G' WHEN f < 0 THEN 'B' || abs(f) ELSE f::text END || lpad(n::text, 2, '0');
      INSERT INTO public.units(floor_id, project_id, building_id, unit_number, unit_type, carpet_area, built_up_area, saleable_area,
        base_rate, floor_rise_rate, parking_charges, other_charges, gst_rate, booking_amount)
      VALUES (v_floor, b.project_id, b.id, v_no, _unit_type, _carpet, _built_up, _saleable, _base_rate,
        greatest(f - 1, 0) * coalesce(_floor_rise_step, 0), _parking_charges, _other_charges, _gst_rate, _booking_amount)
      ON CONFLICT (building_id, unit_number) DO NOTHING;
      IF FOUND THEN v_count := v_count + 1; END IF;
    END LOOP;
  END LOOP;
  UPDATE public.buildings SET planned_floors = greatest(planned_floors, _floor_to) WHERE id = _building_id;
  RETURN v_count;
END; $$;

-- ================= AUDIT =================
CREATE OR REPLACE FUNCTION public.audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old jsonb; v_new jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;
  INSERT INTO public.audit_logs(user_id, action, entity, entity_id, old_data, new_data)
  VALUES (auth.uid(), lower(TG_OP), TG_TABLE_NAME,
          coalesce(v_new->>'id', v_old->>'id', v_new->>'user_id', v_old->>'user_id', v_new->>'role', v_old->>'role'),
          v_old, v_new);
  RETURN coalesce(NEW, OLD);
END; $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['companies','company_bank_accounts','financial_periods','profiles','user_roles','role_permissions','user_project_assignments','projects','buildings','floors','units'] LOOP
    EXECUTE format('CREATE TRIGGER audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.audit_row()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['companies','company_bank_accounts','profiles','projects','buildings','floors','units'] LOOP
    EXECUTE format('CREATE TRIGGER touch_%1$s BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t);
  END LOOP;
END $$;

-- ================= PROFILE BOOTSTRAP =================
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); p public.profiles%ROWTYPE; v_company uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO p FROM public.profiles WHERE id = v_uid;
  IF FOUND THEN RETURN p; END IF;
  SELECT id INTO v_company FROM public.companies ORDER BY created_at LIMIT 1;
  INSERT INTO public.profiles(id, company_id, email, full_name)
  VALUES (v_uid, v_company, auth.jwt()->>'email',
          coalesce(auth.jwt()->'user_metadata'->>'full_name', auth.jwt()->'user_metadata'->>'name', split_part(auth.jwt()->>'email','@',1)))
  RETURNING * INTO p;
  PERFORM pg_advisory_xact_lock(42);
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin') THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'super_admin');
  END IF;
  RETURN p;
END; $$;

-- ================= VIEWS =================
CREATE VIEW public.v_building_stats WITH (security_invoker = true) AS
SELECT b.id AS building_id, b.project_id,
  count(u.id) AS total_units,
  count(u.id) FILTER (WHERE u.status = 'available') AS available_units,
  count(u.id) FILTER (WHERE u.status = 'hold') AS hold_units,
  count(u.id) FILTER (WHERE u.status IN ('booked','agreement_pending')) AS booked_units,
  count(u.id) FILTER (WHERE u.status IN ('agreement_done','registered','possession_pending','possession_completed')) AS sold_units,
  count(u.id) FILTER (WHERE u.status = 'cancelled') AS withdrawn_units,
  coalesce(sum(u.saleable_area), 0) AS saleable_area,
  coalesce(sum(u.total_agreement_value) FILTER (WHERE u.status <> 'cancelled'), 0) AS inventory_value,
  coalesce(sum(u.total_agreement_value) FILTER (WHERE u.status IN ('available','hold')), 0) AS unsold_value
FROM public.buildings b LEFT JOIN public.units u ON u.building_id = b.id
GROUP BY b.id, b.project_id;

-- ================= GRANTS =================
GRANT SELECT, UPDATE ON public.companies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_bank_accounts, public.financial_periods, public.user_project_assignments,
  public.projects, public.buildings, public.floors, public.units TO authenticated;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_roles, public.role_permissions TO authenticated;
GRANT SELECT ON public.permissions, public.unit_status_history, public.audit_logs, public.v_building_stats TO authenticated;
GRANT ALL ON public.companies, public.company_bank_accounts, public.financial_periods, public.profiles, public.user_roles, public.permissions,
  public.role_permissions, public.user_project_assignments, public.projects, public.buildings, public.floors, public.units,
  public.unit_status_history, public.audit_logs, public.v_building_stats TO service_role;
REVOKE EXECUTE ON FUNCTION public.set_unit_status, public.generate_units, public.ensure_profile, public.my_permissions FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_unit_status, public.generate_units, public.ensure_profile, public.my_permissions,
  public.has_permission, public.has_role, public.can_access_project, public.is_active_user TO authenticated;

-- ================= RLS =================
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active staff view company" ON public.companies FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "Managers update company" ON public.companies FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'company.manage')) WITH CHECK (public.has_permission(auth.uid(),'company.manage'));

CREATE POLICY "View bank accounts" ON public.company_bank_accounts FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'company.bank.view') OR public.has_permission(auth.uid(),'company.manage'));
CREATE POLICY "Manage bank accounts" ON public.company_bank_accounts FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'company.manage')) WITH CHECK (public.has_permission(auth.uid(),'company.manage'));

CREATE POLICY "Active staff view periods" ON public.financial_periods FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "Manage periods" ON public.financial_periods FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'company.manage')) WITH CHECK (public.has_permission(auth.uid(),'company.manage'));

CREATE POLICY "View own or staff profiles" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.has_permission(auth.uid(),'users.manage') OR public.has_permission(auth.uid(),'projects.manage'));
CREATE POLICY "User admins update profiles" ON public.profiles FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'users.manage')) WITH CHECK (public.has_permission(auth.uid(),'users.manage'));

CREATE POLICY "View own or all roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_permission(auth.uid(),'users.manage'));
CREATE POLICY "Grant roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'users.manage') AND (role <> 'super_admin' OR public.has_role(auth.uid(),'super_admin')));
CREATE POLICY "Revoke roles" ON public.user_roles FOR DELETE TO authenticated USING (public.has_permission(auth.uid(),'users.manage') AND (role <> 'super_admin' OR public.has_role(auth.uid(),'super_admin')) AND NOT (role = 'super_admin' AND user_id = auth.uid()));

CREATE POLICY "Everyone reads permissions" ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Everyone reads role matrix" ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admin edits matrix" ON public.role_permissions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'super_admin') AND role <> 'super_admin');
CREATE POLICY "Super admin removes matrix" ON public.role_permissions FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'super_admin') AND role <> 'super_admin');

CREATE POLICY "View assignments" ON public.user_project_assignments FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_permission(auth.uid(),'users.manage') OR public.has_permission(auth.uid(),'projects.manage'));
CREATE POLICY "Manage assignments" ON public.user_project_assignments FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'users.manage') OR public.has_permission(auth.uid(),'projects.manage')) WITH CHECK (public.has_permission(auth.uid(),'users.manage') OR public.has_permission(auth.uid(),'projects.manage'));

CREATE POLICY "View accessible projects" ON public.projects FOR SELECT TO authenticated USING (public.can_access_project(auth.uid(), id));
CREATE POLICY "Create projects" ON public.projects FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(),'projects.manage'));
CREATE POLICY "Update projects" ON public.projects FOR UPDATE TO authenticated USING (public.has_permission(auth.uid(),'projects.manage')) WITH CHECK (public.has_permission(auth.uid(),'projects.manage'));
CREATE POLICY "Super admin deletes empty projects" ON public.projects FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'super_admin'));

CREATE POLICY "View buildings" ON public.buildings FOR SELECT TO authenticated USING (public.can_access_project(auth.uid(), project_id));
CREATE POLICY "Manage buildings" ON public.buildings FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'buildings.manage') AND public.can_access_project(auth.uid(), project_id)) WITH CHECK (public.has_permission(auth.uid(),'buildings.manage') AND public.can_access_project(auth.uid(), project_id));

CREATE POLICY "View floors" ON public.floors FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.buildings b WHERE b.id = building_id AND public.can_access_project(auth.uid(), b.project_id)));
CREATE POLICY "Manage floors" ON public.floors FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'buildings.manage') AND EXISTS (SELECT 1 FROM public.buildings b WHERE b.id = building_id AND public.can_access_project(auth.uid(), b.project_id))) WITH CHECK (public.has_permission(auth.uid(),'buildings.manage') AND EXISTS (SELECT 1 FROM public.buildings b WHERE b.id = building_id AND public.can_access_project(auth.uid(), b.project_id)));

CREATE POLICY "View units" ON public.units FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'units.view') AND public.can_access_project(auth.uid(), project_id));
CREATE POLICY "Manage units" ON public.units FOR ALL TO authenticated USING (public.has_permission(auth.uid(),'units.manage') AND public.can_access_project(auth.uid(), project_id)) WITH CHECK (public.has_permission(auth.uid(),'units.manage') AND public.can_access_project(auth.uid(), project_id));

CREATE POLICY "View unit history" ON public.unit_status_history FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.units u WHERE u.id = unit_id AND public.has_permission(auth.uid(),'units.view') AND public.can_access_project(auth.uid(), u.project_id)));
CREATE POLICY "Auditors view logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'audit.view'));

-- ================= PERMISSION CATALOGUE =================
INSERT INTO public.permissions(code, module, description, sort_order) VALUES
('company.view','Company','View company profile',10),
('company.manage','Company','Edit company settings, banks, financial years',11),
('company.bank.view','Company','View company bank account details',12),
('users.manage','Administration','Manage users, roles and project assignments',20),
('audit.view','Administration','View audit log',21),
('projects.view_all','Projects','View all projects (otherwise only assigned)',30),
('projects.manage','Projects','Create and edit projects',31),
('buildings.manage','Projects','Create and edit buildings and floors',32),
('units.view','Inventory','View unit inventory and pricing',40),
('units.manage','Inventory','Create, edit, price and withdraw units',41),
('units.hold','Inventory','Place and release unit holds',42),
('crm.leads','CRM','Leads, site visits and follow-ups',50),
('crm.customers','CRM','Customer records',51),
('sales.bookings','Sales','Create and manage bookings',60),
('sales.collections','Sales','Customer collections and receipts',61),
('procurement.vendors','Procurement','Vendor master',70),
('procurement.purchase','Procurement','Purchase requests, orders, GRN, vendor invoices',71),
('inventory.materials','Materials','Material stock and transfers',80),
('inventory.consume','Materials','Record material receipts and consumption at site',81),
('construction.manage','Construction','Contractors, work orders and budgets',90),
('construction.update','Construction','Post construction progress and site expenses',91),
('costs.view','Costing','View project, building and unit costs',100),
('accounting.post','Accounting','Post journals, payments and invoices',110),
('accounting.view','Accounting','View ledgers and financial statements',111),
('tax.configure','Accounting','GST / TDS configuration',112),
('rera.manage','RERA','RERA compliance and filings',120),
('reports.view','Reports','Management reports and dashboards',130);

INSERT INTO public.role_permissions(role, permission_code)
SELECT r::public.app_role, c FROM (VALUES
 ('director', ARRAY['company.view','company.bank.view','audit.view','projects.view_all','projects.manage','buildings.manage','units.view','units.hold','crm.customers','sales.bookings','sales.collections','procurement.vendors','costs.view','accounting.view','rera.manage','reports.view']),
 ('sales_manager', ARRAY['company.view','projects.view_all','units.view','units.hold','crm.leads','crm.customers','sales.bookings','reports.view']),
 ('sales_executive', ARRAY['company.view','projects.view_all','units.view','units.hold','crm.leads','crm.customers']),
 ('accounts_manager', ARRAY['company.view','company.bank.view','projects.view_all','units.view','sales.collections','procurement.purchase','accounting.post','accounting.view','tax.configure','costs.view','reports.view']),
 ('purchase_manager', ARRAY['company.view','projects.view_all','procurement.vendors','procurement.purchase','inventory.materials']),
 ('site_engineer', ARRAY['company.view','inventory.consume','construction.update']),
 ('project_manager', ARRAY['company.view','projects.view_all','projects.manage','buildings.manage','units.view','construction.manage','construction.update','costs.view']),
 ('accountant', ARRAY['company.view','company.bank.view','projects.view_all','accounting.post','accounting.view','sales.collections'])
) AS m(r, codes), unnest(m.codes) AS c;
INSERT INTO public.role_permissions(role, permission_code) SELECT 'super_admin', code FROM public.permissions;

-- ================= DEMO DATA =================
DO $$
DECLARE c uuid; p1 uuid; p2 uuid; ba uuid; bb uuid; bc uuid; f int; n int; v_floor uuid; t public.unit_type;
BEGIN
  INSERT INTO public.companies(name, legal_name, registered_address, office_address, phone, email, pan, tan, gstin, cin, rera_promoter_id, rera_details, invoice_terms)
  VALUES ('KK Group','KK Infra Developers Private Limited',
    '402, Shreeji Arcade, FC Road, Shivajinagar, Pune, Maharashtra 411005',
    'KK House, Baner–Pashan Link Road, Baner, Pune, Maharashtra 411045',
    '+91 20 4710 2200','accounts@kkgroup.in','AAKCK4821F','PNEK08734D','27AAKCK4821F1Z6','U45200PN2011PTC139874',
    'MahaRERA Promoter ID: PR1260002501','Registered with MahaRERA. Separate RERA (70%) collection account maintained per project.',
    'Payment within 15 days of demand. Interest at SBI MCLR + 2% on delayed payments as per RERA.')
  RETURNING id INTO c;

  INSERT INTO public.company_bank_accounts(company_id, account_name, bank_name, branch, account_number, ifsc, account_type, purpose, is_primary) VALUES
   (c,'KK Infra Developers Pvt Ltd','HDFC Bank','Baner, Pune','50200045871236','HDFC0001721','current','Operations',true),
   (c,'KK Heights RERA Collection A/c','State Bank of India','Aundh, Pune','39871204556','SBIN0011582','current','RERA 70% designated account',false),
   (c,'KK Heights Master Collection A/c','ICICI Bank','Baner, Pune','025405007781','ICIC0000254','current','Customer collections',false);

  INSERT INTO public.financial_periods(company_id, label, start_date, end_date, is_current) VALUES
   (c,'FY 2025-26','2025-04-01','2026-03-31',false),
   (c,'FY 2026-27','2026-04-01','2027-03-31',true);

  INSERT INTO public.projects(company_id, code, name, location, address, city, state, pincode, land_area_sqm, development_area_sqft, start_date, expected_completion_date, status, developer_details, architect, structural_consultant, rera_number, rera_registration_date, rera_valid_until, description)
  VALUES (c,'KKH','KK Heights','Baner','S. No. 112/2, Near Balewadi High Street, Baner','Pune','Maharashtra','411045',6070,186000,'2024-11-15','2027-12-31','under_construction',
    'KK Infra Developers Pvt Ltd','Studio Venkatesh Architects, Pune','Sterling Structural Consultants','P52100054321','2024-09-20','2028-06-30',
    'Two-wing residential project of 2 & 3 BHK apartments with podium amenities, clubhouse and stilt parking.')
  RETURNING id INTO p1;
  INSERT INTO public.projects(company_id, code, name, location, address, city, state, pincode, land_area_sqm, development_area_sqft, start_date, expected_completion_date, status, developer_details, architect, structural_consultant, rera_number, rera_registration_date, rera_valid_until, description)
  VALUES (c,'KKBP','KK Business Park','Wakad','S. No. 54/1, Hinjewadi–Wakad Road, Wakad','Pune','Maharashtra','411057',2430,64000,'2026-08-01','2029-03-31','approval',
    'KK Infra Developers Pvt Ltd','Studio Venkatesh Architects, Pune','Sterling Structural Consultants',NULL,NULL,NULL,
    'Commercial tower with ground-floor retail and office suites. Building plan approval in progress.')
  RETURNING id INTO p2;

  INSERT INTO public.buildings(project_id, name, code, wing, planned_floors, ground_floor_config, construction_start, expected_completion, progress_pct, budget, status)
  VALUES (p1,'Building A','A','A Wing',7,'Stilt parking + entrance lobby','2024-12-01','2027-06-30',62,285000000,'in_progress') RETURNING id INTO ba;
  INSERT INTO public.buildings(project_id, name, code, wing, planned_floors, ground_floor_config, construction_start, expected_completion, progress_pct, budget, status)
  VALUES (p1,'Building B','B','B Wing',7,'Stilt parking + society office','2025-05-15','2027-12-31',35,242000000,'in_progress') RETURNING id INTO bb;
  INSERT INTO public.buildings(project_id, name, code, wing, planned_floors, ground_floor_config, construction_start, expected_completion, progress_pct, budget, status)
  VALUES (p2,'Tower C','C','Commercial Tower',3,'Retail shops with frontage','2026-08-01','2029-03-31',0,198000000,'not_started') RETURNING id INTO bc;

  -- Stilt floors
  INSERT INTO public.floors(building_id, floor_number, name, construction_status, completion_pct) VALUES
   (ba,0,'Stilt Parking','completed',100),(bb,0,'Stilt Parking','completed',100);

  -- Building A: 7 floors x 4 (01/04 = 3BHK, 02/03 = 2BHK)
  FOR f IN 1..7 LOOP
    INSERT INTO public.floors(building_id, floor_number, name, construction_status, completion_pct)
    VALUES (ba, f, 'Floor ' || f,
      CASE WHEN f <= 4 THEN 'completed' WHEN f <= 6 THEN 'in_progress' ELSE 'not_started' END::public.work_status,
      CASE WHEN f <= 4 THEN 100 WHEN f = 5 THEN 80 WHEN f = 6 THEN 45 ELSE 0 END)
    RETURNING id INTO v_floor;
    FOR n IN 1..4 LOOP
      t := CASE WHEN n IN (1,4) THEN '3bhk' ELSE '2bhk' END;
      INSERT INTO public.units(floor_id, project_id, building_id, unit_number, unit_type, facing, carpet_area, built_up_area, saleable_area, balcony_area,
        parking_count, parking_details, base_rate, floor_rise_rate, parking_charges, other_charges, gst_rate, booking_amount)
      VALUES (v_floor, p1, ba, 'A-' || f || lpad(n::text,2,'0'), t, CASE n WHEN 1 THEN 'East' WHEN 2 THEN 'East' WHEN 3 THEN 'West' ELSE 'West' END,
        CASE WHEN t='3bhk' THEN 1052 ELSE 762 END, CASE WHEN t='3bhk' THEN 1262 ELSE 914 END, CASE WHEN t='3bhk' THEN 1455 ELSE 1050 END,
        CASE WHEN t='3bhk' THEN 96 ELSE 64 END, 1, 'Covered stilt parking',
        8650, (f-1)*50, CASE WHEN t='3bhk' THEN 350000 ELSE 300000 END, 185000, 5,
        CASE WHEN t='3bhk' THEN 300000 ELSE 200000 END);
    END LOOP;
  END LOOP;

  -- Building B: 7 floors x 4 (01/02 = 1BHK, 03/04 = 2BHK)
  FOR f IN 1..7 LOOP
    INSERT INTO public.floors(building_id, floor_number, name, construction_status, completion_pct)
    VALUES (bb, f, 'Floor ' || f,
      CASE WHEN f <= 2 THEN 'completed' WHEN f = 3 THEN 'in_progress' ELSE 'not_started' END::public.work_status,
      CASE WHEN f <= 2 THEN 100 WHEN f = 3 THEN 55 ELSE 0 END)
    RETURNING id INTO v_floor;
    FOR n IN 1..4 LOOP
      t := CASE WHEN n IN (1,2) THEN '1bhk' ELSE '2bhk' END;
      INSERT INTO public.units(floor_id, project_id, building_id, unit_number, unit_type, facing, carpet_area, built_up_area, saleable_area, balcony_area,
        parking_count, parking_details, base_rate, floor_rise_rate, parking_charges, other_charges, gst_rate, booking_amount)
      VALUES (v_floor, p1, bb, 'B-' || f || lpad(n::text,2,'0'), t, CASE WHEN n <= 2 THEN 'North' ELSE 'South' END,
        CASE WHEN t='1bhk' THEN 478 ELSE 748 END, CASE WHEN t='1bhk' THEN 574 ELSE 898 END, CASE WHEN t='1bhk' THEN 680 ELSE 1030 END,
        CASE WHEN t='1bhk' THEN 42 ELSE 60 END, CASE WHEN t='1bhk' THEN 0 ELSE 1 END, CASE WHEN t='1bhk' THEN 'Two-wheeler parking' ELSE 'Covered stilt parking' END,
        8250, (f-1)*50, CASE WHEN t='1bhk' THEN 0 ELSE 300000 END, 150000, 5,
        CASE WHEN t='1bhk' THEN 100000 ELSE 200000 END);
    END LOOP;
  END LOOP;

  -- Tower C: ground shops, floors 1-3 offices
  INSERT INTO public.floors(building_id, floor_number, name) VALUES (bc,0,'Ground Floor (Retail)') RETURNING id INTO v_floor;
  FOR n IN 1..6 LOOP
    INSERT INTO public.units(floor_id, project_id, building_id, unit_number, unit_type, facing, carpet_area, built_up_area, saleable_area, base_rate, other_charges, gst_rate, booking_amount)
    VALUES (v_floor, p2, bc, 'C-G' || lpad(n::text,2,'0'), 'shop', 'Main road', 310 + n*15, 372 + n*18, 430 + n*20, 18500, 125000, 12, 500000);
  END LOOP;
  FOR f IN 1..3 LOOP
    INSERT INTO public.floors(building_id, floor_number, name) VALUES (bc, f, 'Floor ' || f) RETURNING id INTO v_floor;
    FOR n IN 1..4 LOOP
      INSERT INTO public.units(floor_id, project_id, building_id, unit_number, unit_type, carpet_area, built_up_area, saleable_area, parking_count, parking_details, base_rate, floor_rise_rate, parking_charges, other_charges, gst_rate, booking_amount)
      VALUES (v_floor, p2, bc, 'C-' || f || lpad(n::text,2,'0'), 'office', 620, 740, 880, 1, 'Basement car park', 11200, (f-1)*75, 450000, 160000, 12, 400000);
    END LOOP;
  END LOOP;

  -- Holds & withdrawals via the status workflow
  PERFORM set_config('app.unit_status_source','rpc',true);
  PERFORM set_config('app.unit_status_reason','Held for Mr. R. Deshpande pending loan sanction',true);
  UPDATE public.units SET status='hold', hold_reason='Held for Mr. R. Deshpande pending loan sanction', hold_until='2026-10-15 18:00+05:30' WHERE building_id=ba AND unit_number='A-503';
  PERFORM set_config('app.unit_status_reason','Management hold – corner unit pricing review',true);
  UPDATE public.units SET status='hold', hold_reason='Management hold – corner unit pricing review' WHERE building_id=ba AND unit_number='A-704';
  PERFORM set_config('app.unit_status_reason','Channel partner hold (Square Yards) – 48h',true);
  UPDATE public.units SET status='hold', hold_reason='Channel partner hold (Square Yards) – 48h', hold_until='2026-10-03 18:00+05:30' WHERE building_id=bb AND unit_number='B-302';
  PERFORM set_config('app.unit_status_reason','Reserved for landowner as per development agreement',true);
  UPDATE public.units SET status='cancelled' WHERE building_id=bb AND unit_number IN ('B-101','B-102');
  PERFORM set_config('app.unit_status_source','',true);
  PERFORM set_config('app.unit_status_reason','',true);
END $$;