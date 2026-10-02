CREATE TYPE public.pr_status AS ENUM ('draft','pending_approval','approved','rejected','cancelled');
CREATE TYPE public.pr_priority AS ENUM ('low','normal','high','urgent');
CREATE TYPE public.pr_request_type AS ENUM ('material','equipment','service','other');
CREATE TYPE public.pr_action AS ENUM ('created','submitted','approved','rejected','returned','cancelled');

CREATE TABLE public.pr_number_counters (year int PRIMARY KEY, last_value int NOT NULL DEFAULT 0);
GRANT ALL ON public.pr_number_counters TO service_role;
ALTER TABLE public.pr_number_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_number text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  building_id uuid REFERENCES public.buildings(id),
  floor_id uuid REFERENCES public.floors(id),
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  request_date date NOT NULL DEFAULT current_date,
  required_by date NOT NULL,
  priority public.pr_priority NOT NULL DEFAULT 'normal',
  request_type public.pr_request_type NOT NULL DEFAULT 'material',
  purpose text,
  remarks text,
  status public.pr_status NOT NULL DEFAULT 'draft',
  estimated_total numeric(16,2) NOT NULL DEFAULT 0,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.purchase_requests(project_id);
CREATE INDEX ON public.purchase_requests(status);
CREATE INDEX ON public.purchase_requests(requested_by);
CREATE INDEX ON public.purchase_requests(request_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_requests TO authenticated;
GRANT ALL ON public.purchase_requests TO service_role;
ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.purchase_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  line_no int NOT NULL DEFAULT 1,
  material_id uuid NOT NULL REFERENCES public.items(id),
  description text,
  quantity numeric(16,3) NOT NULL CHECK (quantity > 0),
  unit_id uuid NOT NULL REFERENCES public.units_of_measure(id),
  estimated_rate numeric(16,2) CHECK (estimated_rate IS NULL OR estimated_rate >= 0),
  estimated_amount numeric(16,2) NOT NULL DEFAULT 0,
  required_by date,
  purpose text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.purchase_request_items(purchase_request_id);
CREATE INDEX ON public.purchase_request_items(material_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_request_items TO authenticated;
GRANT ALL ON public.purchase_request_items TO service_role;
ALTER TABLE public.purchase_request_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.purchase_request_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  action public.pr_action NOT NULL,
  acted_by uuid REFERENCES public.profiles(id),
  acted_at timestamptz NOT NULL DEFAULT now(),
  comment text,
  previous_status public.pr_status,
  new_status public.pr_status
);
CREATE INDEX ON public.purchase_request_approvals(purchase_request_id, acted_at);
GRANT SELECT ON public.purchase_request_approvals TO authenticated;
GRANT ALL ON public.purchase_request_approvals TO service_role;
ALTER TABLE public.purchase_request_approvals ENABLE ROW LEVEL SECURITY;

-- Permissions
INSERT INTO public.permissions(code, module, description, sort_order) VALUES
 ('purchase_request.view','procurement','View purchase requests',300),
 ('purchase_request.create','procurement','Create purchase requests',301),
 ('purchase_request.edit','procurement','Edit draft purchase requests',302),
 ('purchase_request.submit','procurement','Submit purchase requests for approval',303),
 ('purchase_request.approve','procurement','Approve or return purchase requests',304),
 ('purchase_request.reject','procurement','Reject purchase requests',305),
 ('purchase_request.cancel','procurement','Cancel purchase requests',306)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions(role, permission_code)
SELECT r::public.app_role, c FROM (VALUES
 ('director','purchase_request.view'),('director','purchase_request.approve'),('director','purchase_request.reject'),('director','purchase_request.cancel'),
 ('purchase_manager','purchase_request.view'),('purchase_manager','purchase_request.create'),('purchase_manager','purchase_request.edit'),('purchase_manager','purchase_request.submit'),('purchase_manager','purchase_request.approve'),('purchase_manager','purchase_request.reject'),('purchase_manager','purchase_request.cancel'),
 ('project_manager','purchase_request.view'),('project_manager','purchase_request.create'),('project_manager','purchase_request.edit'),('project_manager','purchase_request.submit'),('project_manager','purchase_request.approve'),('project_manager','purchase_request.reject'),('project_manager','purchase_request.cancel'),
 ('site_engineer','purchase_request.view'),('site_engineer','purchase_request.create'),('site_engineer','purchase_request.edit'),('site_engineer','purchase_request.submit'),('site_engineer','purchase_request.cancel'),
 ('store_manager','purchase_request.view'),('store_manager','purchase_request.create'),('store_manager','purchase_request.edit'),('store_manager','purchase_request.submit'),('store_manager','purchase_request.cancel'),
 ('accounts_manager','purchase_request.view'),('accountant','purchase_request.view'),('auditor','purchase_request.view')
) v(r,c) ON CONFLICT DO NOTHING;

-- Before insert/update on header
CREATE OR REPLACE FUNCTION public.pr_before_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_year int; v_next int; v_src text := coalesce(current_setting('app.pr_source', true), '');
BEGIN
  IF NEW.building_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM buildings WHERE id = NEW.building_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Selected building does not belong to the project.'; END IF;
  IF NEW.floor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM floors WHERE id = NEW.floor_id AND building_id = NEW.building_id) THEN
    RAISE EXCEPTION 'Selected floor does not belong to the building.'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'New purchase requests start as Draft.'; END IF;
    v_year := extract(year FROM coalesce(NEW.request_date, current_date))::int;
    INSERT INTO pr_number_counters(year, last_value) VALUES (v_year, 1)
      ON CONFLICT (year) DO UPDATE SET last_value = pr_number_counters.last_value + 1
      RETURNING last_value INTO v_next;
    NEW.pr_number := 'PR-' || v_year || '-' || lpad(v_next::text, 4, '0');
    NEW.estimated_total := 0;
    NEW.submitted_at := NULL; NEW.approved_at := NULL; NEW.approved_by := NULL; NEW.submitted_by := NULL;
    SELECT company_id INTO NEW.company_id FROM projects WHERE id = NEW.project_id;
  ELSE
    NEW.pr_number := OLD.pr_number; NEW.requested_by := OLD.requested_by; NEW.company_id := OLD.company_id; NEW.created_at := OLD.created_at;
    IF v_src <> 'rpc' THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Status changes only through workflow actions.'; END IF;
      IF OLD.status <> 'draft' AND v_src <> 'total' THEN RAISE EXCEPTION 'Only draft purchase requests can be edited.'; END IF;
      NEW.submitted_at := OLD.submitted_at; NEW.submitted_by := OLD.submitted_by; NEW.approved_at := OLD.approved_at; NEW.approved_by := OLD.approved_by;
      IF v_src <> 'total' THEN NEW.estimated_total := OLD.estimated_total; END IF;
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pr_before_write BEFORE INSERT OR UPDATE ON public.purchase_requests FOR EACH ROW EXECUTE FUNCTION public.pr_before_write();

CREATE OR REPLACE FUNCTION public.pr_after_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO purchase_request_approvals(purchase_request_id, action, acted_by, new_status) VALUES (NEW.id, 'created', auth.uid(), 'draft');
  RETURN NEW;
END $$;
CREATE TRIGGER pr_after_insert AFTER INSERT ON public.purchase_requests FOR EACH ROW EXECUTE FUNCTION public.pr_after_insert();

-- Items
CREATE OR REPLACE FUNCTION public.pr_items_before_write() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.estimated_amount := round(NEW.quantity * coalesce(NEW.estimated_rate, 0), 2);
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER pr_items_before_write BEFORE INSERT OR UPDATE ON public.purchase_request_items FOR EACH ROW EXECUTE FUNCTION public.pr_items_before_write();

CREATE OR REPLACE FUNCTION public.pr_items_after_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pr uuid := coalesce(NEW.purchase_request_id, OLD.purchase_request_id);
BEGIN
  PERFORM set_config('app.pr_source', 'total', true);
  UPDATE purchase_requests SET estimated_total = coalesce((SELECT sum(estimated_amount) FROM purchase_request_items WHERE purchase_request_id = v_pr), 0) WHERE id = v_pr;
  PERFORM set_config('app.pr_source', '', true);
  RETURN NULL;
END $$;
CREATE TRIGGER pr_items_after_write AFTER INSERT OR UPDATE OR DELETE ON public.purchase_request_items FOR EACH ROW EXECUTE FUNCTION public.pr_items_after_write();

CREATE TRIGGER audit_purchase_requests AFTER INSERT OR UPDATE OR DELETE ON public.purchase_requests FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_purchase_request_items AFTER INSERT OR UPDATE OR DELETE ON public.purchase_request_items FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- Policies
CREATE POLICY "View PRs" ON public.purchase_requests FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(),'purchase_request.view') AND (requested_by = auth.uid() OR public.can_access_project(auth.uid(), project_id)));
CREATE POLICY "Create PRs" ON public.purchase_requests FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid() AND public.has_permission(auth.uid(),'purchase_request.create') AND public.can_access_project(auth.uid(), project_id));
CREATE POLICY "Edit own draft PRs" ON public.purchase_requests FOR UPDATE TO authenticated
  USING (status = 'draft' AND requested_by = auth.uid() AND public.has_permission(auth.uid(),'purchase_request.edit'))
  WITH CHECK (status = 'draft' AND public.can_access_project(auth.uid(), project_id));
CREATE POLICY "Delete own draft PRs" ON public.purchase_requests FOR DELETE TO authenticated
  USING (status = 'draft' AND requested_by = auth.uid() AND NOT EXISTS (SELECT 1 FROM public.purchase_request_approvals a WHERE a.purchase_request_id = id AND a.action <> 'created'));

CREATE POLICY "View PR items" ON public.purchase_request_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_requests p WHERE p.id = purchase_request_id));
CREATE POLICY "Write draft PR items" ON public.purchase_request_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_requests p WHERE p.id = purchase_request_id AND p.status = 'draft' AND p.requested_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_requests p WHERE p.id = purchase_request_id AND p.status = 'draft' AND p.requested_by = auth.uid()));

CREATE POLICY "View PR history" ON public.purchase_request_approvals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_requests p WHERE p.id = purchase_request_id));

-- Workflow action
CREATE OR REPLACE FUNCTION public.pr_transition(_pr_id uuid, _action public.pr_action, _comment text DEFAULT NULL)
RETURNS public.pr_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p purchase_requests%ROWTYPE; v_uid uuid := auth.uid(); v_new pr_status; v_items int;
BEGIN
  IF v_uid IS NULL OR NOT is_active_user(v_uid) THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO p FROM purchase_requests WHERE id = _pr_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase request not found.'; END IF;
  IF NOT (p.requested_by = v_uid OR can_access_project(v_uid, p.project_id)) THEN RAISE EXCEPTION 'You do not have access to this project.'; END IF;
  _comment := nullif(trim(coalesce(_comment,'')), '');

  IF _action = 'submitted' THEN
    IF p.status <> 'draft' THEN RAISE EXCEPTION 'Only draft requests can be submitted.'; END IF;
    IF p.requested_by <> v_uid OR NOT has_permission(v_uid,'purchase_request.submit') THEN RAISE EXCEPTION 'You cannot submit this request.'; END IF;
    SELECT count(*) INTO v_items FROM purchase_request_items WHERE purchase_request_id = _pr_id;
    IF v_items = 0 THEN RAISE EXCEPTION 'Add at least one item before submitting.'; END IF;
    IF coalesce(trim(p.purpose),'') = '' THEN RAISE EXCEPTION 'Purpose is required before submitting.'; END IF;
    v_new := 'pending_approval';
  ELSIF _action IN ('approved','returned') THEN
    IF p.status <> 'pending_approval' THEN RAISE EXCEPTION 'Only pending requests can be approved or returned.'; END IF;
    IF NOT has_permission(v_uid,'purchase_request.approve') THEN RAISE EXCEPTION 'You do not have permission to approve.'; END IF;
    IF p.requested_by = v_uid THEN RAISE EXCEPTION 'You cannot approve or return your own request.'; END IF;
    IF _action = 'returned' AND _comment IS NULL THEN RAISE EXCEPTION 'A comment is required when returning a request.'; END IF;
    v_new := CASE WHEN _action = 'approved' THEN 'approved'::pr_status ELSE 'draft'::pr_status END;
  ELSIF _action = 'rejected' THEN
    IF p.status <> 'pending_approval' THEN RAISE EXCEPTION 'Only pending requests can be rejected.'; END IF;
    IF NOT has_permission(v_uid,'purchase_request.reject') THEN RAISE EXCEPTION 'You do not have permission to reject.'; END IF;
    IF p.requested_by = v_uid THEN RAISE EXCEPTION 'You cannot reject your own request.'; END IF;
    IF _comment IS NULL THEN RAISE EXCEPTION 'A reason is required when rejecting.'; END IF;
    v_new := 'rejected';
  ELSIF _action = 'cancelled' THEN
    IF p.status NOT IN ('draft','pending_approval') THEN RAISE EXCEPTION 'Only draft or pending requests can be cancelled.'; END IF;
    IF NOT has_permission(v_uid,'purchase_request.cancel') THEN RAISE EXCEPTION 'You do not have permission to cancel.'; END IF;
    IF p.requested_by <> v_uid AND NOT has_permission(v_uid,'purchase_request.approve') THEN RAISE EXCEPTION 'Only the requester or an approver can cancel.'; END IF;
    v_new := 'cancelled';
  ELSE
    RAISE EXCEPTION 'Unsupported action.';
  END IF;

  PERFORM set_config('app.pr_source', 'rpc', true);
  UPDATE purchase_requests SET status = v_new,
    submitted_at = CASE WHEN _action = 'submitted' THEN now() ELSE submitted_at END,
    submitted_by = CASE WHEN _action = 'submitted' THEN v_uid ELSE submitted_by END,
    approved_at = CASE WHEN _action = 'approved' THEN now() ELSE approved_at END,
    approved_by = CASE WHEN _action = 'approved' THEN v_uid ELSE approved_by END
  WHERE id = _pr_id;
  PERFORM set_config('app.pr_source', '', true);
  INSERT INTO purchase_request_approvals(purchase_request_id, action, acted_by, comment, previous_status, new_status)
  VALUES (_pr_id, _action, v_uid, _comment, p.status, v_new);
  RETURN v_new;
END $$;
REVOKE EXECUTE ON FUNCTION public.pr_transition FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pr_transition TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pr_before_write, public.pr_after_insert, public.pr_items_after_write FROM anon, public, authenticated;