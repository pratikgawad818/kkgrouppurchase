CREATE TYPE public.rfq_status AS ENUM ('draft','sent','partially_responded','fully_responded','ready_for_po','closed','cancelled');
CREATE TYPE public.rfq_vendor_status AS ENUM ('pending','responded','declined');
CREATE TYPE public.quotation_status AS ENUM ('draft','submitted','selected','rejected');

CREATE TABLE public.rfq_number_counters (year int PRIMARY KEY, last_value int NOT NULL DEFAULT 0);
ALTER TABLE public.rfq_number_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_number text NOT NULL UNIQUE DEFAULT '',
  purchase_request_id uuid NOT NULL REFERENCES public.purchase_requests(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  building_id uuid REFERENCES public.buildings(id),
  rfq_date date NOT NULL DEFAULT current_date,
  response_due_date date NOT NULL,
  required_by_date date,
  status public.rfq_status NOT NULL DEFAULT 'draft',
  remarks text,
  selection_reason text,
  created_by uuid NOT NULL REFERENCES public.profiles(id) DEFAULT auth.uid(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.rfqs(purchase_request_id);
CREATE INDEX ON public.rfqs(project_id, status);

CREATE TABLE public.rfq_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  pr_item_id uuid REFERENCES public.purchase_request_items(id),
  line_no int NOT NULL,
  material_id uuid NOT NULL REFERENCES public.items(id),
  description text,
  requested_quantity numeric NOT NULL CHECK (requested_quantity > 0),
  unit_id uuid NOT NULL REFERENCES public.units_of_measure(id),
  target_rate numeric,
  required_by date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.rfq_items(rfq_id);

CREATE TABLE public.rfq_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  status public.rfq_vendor_status NOT NULL DEFAULT 'pending',
  invited_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  remarks text,
  UNIQUE (rfq_id, vendor_id)
);

CREATE TABLE public.vendor_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES public.rfqs(id),
  rfq_vendor_id uuid NOT NULL REFERENCES public.rfq_vendors(id),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  quotation_number text NOT NULL,
  quotation_date date NOT NULL DEFAULT current_date,
  valid_until date,
  delivery_days int,
  payment_terms text,
  subtotal numeric NOT NULL DEFAULT 0,
  discount_total numeric NOT NULL DEFAULT 0,
  tax_total numeric NOT NULL DEFAULT 0,
  freight numeric NOT NULL DEFAULT 0 CHECK (freight >= 0),
  other_charges numeric NOT NULL DEFAULT 0 CHECK (other_charges >= 0),
  grand_total numeric NOT NULL DEFAULT 0,
  status public.quotation_status NOT NULL DEFAULT 'submitted',
  attachment_path text,
  remarks text,
  created_by uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rfq_vendor_id)
);
CREATE INDEX ON public.vendor_quotations(rfq_id);

CREATE TABLE public.vendor_quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.vendor_quotations(id) ON DELETE CASCADE,
  rfq_item_id uuid NOT NULL REFERENCES public.rfq_items(id),
  is_quoted boolean NOT NULL DEFAULT true,
  quoted_quantity numeric NOT NULL DEFAULT 0 CHECK (quoted_quantity >= 0),
  rate numeric NOT NULL DEFAULT 0 CHECK (rate >= 0),
  discount_amount numeric NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_type text NOT NULL DEFAULT 'cgst_sgst' CHECK (tax_type IN ('cgst_sgst','igst','none')),
  tax_rate_percent numeric NOT NULL DEFAULT 18 CHECK (tax_rate_percent >= 0 AND tax_rate_percent <= 100),
  taxable_amount numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  delivery_days int,
  remarks text,
  UNIQUE (quotation_id, rfq_item_id)
);

CREATE TABLE public.vendor_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES public.rfqs(id),
  rfq_item_id uuid NOT NULL REFERENCES public.rfq_items(id),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  quotation_id uuid NOT NULL REFERENCES public.vendor_quotations(id),
  quotation_item_id uuid NOT NULL REFERENCES public.vendor_quotation_items(id),
  selected_quantity numeric NOT NULL,
  awarded_rate numeric NOT NULL,
  reason text,
  selected_by uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  selected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rfq_item_id)
);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfqs, public.rfq_items, public.rfq_vendors, public.vendor_quotations, public.vendor_quotation_items TO authenticated;
GRANT SELECT ON public.vendor_selections TO authenticated;
GRANT ALL ON public.rfqs, public.rfq_items, public.rfq_vendors, public.vendor_quotations, public.vendor_quotation_items, public.vendor_selections, public.rfq_number_counters TO service_role;

ALTER TABLE public.rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_selections ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rfq_can_view(_rfq_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM rfqs r WHERE r.id = _rfq_id
    AND has_permission(auth.uid(),'rfq.view') AND can_access_project(auth.uid(), r.project_id));
$$;
CREATE OR REPLACE FUNCTION public.rfq_can_edit_draft(_rfq_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM rfqs r WHERE r.id = _rfq_id AND r.status = 'draft'
    AND has_permission(auth.uid(),'rfq.edit') AND can_access_project(auth.uid(), r.project_id));
$$;
CREATE OR REPLACE FUNCTION public.rfq_can_quote(_rfq_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM rfqs r WHERE r.id = _rfq_id
    AND r.status IN ('sent','partially_responded','fully_responded')
    AND has_permission(auth.uid(),'quotation.create') AND can_access_project(auth.uid(), r.project_id));
$$;

CREATE POLICY "View rfqs" ON public.rfqs FOR SELECT TO authenticated
  USING (has_permission(auth.uid(),'rfq.view') AND can_access_project(auth.uid(), project_id));
CREATE POLICY "Create rfqs" ON public.rfqs FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(),'rfq.create') AND can_access_project(auth.uid(), project_id) AND created_by = auth.uid());
CREATE POLICY "Edit draft rfqs" ON public.rfqs FOR UPDATE TO authenticated
  USING (status = 'draft' AND has_permission(auth.uid(),'rfq.edit') AND can_access_project(auth.uid(), project_id))
  WITH CHECK (has_permission(auth.uid(),'rfq.edit') AND can_access_project(auth.uid(), project_id));

CREATE POLICY "View rfq items" ON public.rfq_items FOR SELECT TO authenticated USING (rfq_can_view(rfq_id));
CREATE POLICY "Insert rfq items" ON public.rfq_items FOR INSERT TO authenticated WITH CHECK (rfq_can_edit_draft(rfq_id));
CREATE POLICY "Update rfq items" ON public.rfq_items FOR UPDATE TO authenticated USING (rfq_can_edit_draft(rfq_id)) WITH CHECK (rfq_can_edit_draft(rfq_id));
CREATE POLICY "Delete rfq items" ON public.rfq_items FOR DELETE TO authenticated USING (rfq_can_edit_draft(rfq_id));

CREATE POLICY "View rfq vendors" ON public.rfq_vendors FOR SELECT TO authenticated USING (rfq_can_view(rfq_id));
CREATE POLICY "Insert rfq vendors" ON public.rfq_vendors FOR INSERT TO authenticated WITH CHECK (rfq_can_edit_draft(rfq_id));
CREATE POLICY "Delete rfq vendors" ON public.rfq_vendors FOR DELETE TO authenticated USING (rfq_can_edit_draft(rfq_id));

CREATE POLICY "View quotations" ON public.vendor_quotations FOR SELECT TO authenticated
  USING (has_permission(auth.uid(),'quotation.view') AND rfq_can_view(rfq_id));
CREATE POLICY "Insert quotations" ON public.vendor_quotations FOR INSERT TO authenticated WITH CHECK (rfq_can_quote(rfq_id));
CREATE POLICY "Update quotations" ON public.vendor_quotations FOR UPDATE TO authenticated
  USING (status IN ('draft','submitted') AND has_permission(auth.uid(),'quotation.edit') AND rfq_can_quote(rfq_id))
  WITH CHECK (status IN ('draft','submitted') AND rfq_can_quote(rfq_id));

CREATE POLICY "View quotation items" ON public.vendor_quotation_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM vendor_quotations q WHERE q.id = quotation_id AND has_permission(auth.uid(),'quotation.view') AND rfq_can_view(q.rfq_id)));
CREATE POLICY "Write quotation items" ON public.vendor_quotation_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM vendor_quotations q WHERE q.id = quotation_id AND q.status IN ('draft','submitted') AND rfq_can_quote(q.rfq_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM vendor_quotations q WHERE q.id = quotation_id AND q.status IN ('draft','submitted') AND rfq_can_quote(q.rfq_id)));

CREATE POLICY "View selections" ON public.vendor_selections FOR SELECT TO authenticated USING (rfq_can_view(rfq_id));

-- RFQ before write: numbering, PR approval, immutable identity, status only via rpc
CREATE OR REPLACE FUNCTION public.rfq_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pr record; y int; n int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO pr FROM purchase_requests WHERE id = NEW.purchase_request_id;
    IF pr IS NULL OR pr.status <> 'approved' THEN RAISE EXCEPTION 'RFQ can only be created from an approved purchase request'; END IF;
    NEW.company_id := pr.company_id; NEW.project_id := pr.project_id; NEW.building_id := pr.building_id;
    NEW.status := 'draft';
    y := extract(year from now())::int;
    INSERT INTO rfq_number_counters(year,last_value) VALUES (y,1)
      ON CONFLICT (year) DO UPDATE SET last_value = rfq_number_counters.last_value + 1 RETURNING last_value INTO n;
    NEW.rfq_number := 'RFQ-' || y || '-' || lpad(n::text,4,'0');
  ELSE
    NEW.rfq_number := OLD.rfq_number; NEW.purchase_request_id := OLD.purchase_request_id;
    NEW.company_id := OLD.company_id; NEW.project_id := OLD.project_id; NEW.building_id := OLD.building_id;
    NEW.created_by := OLD.created_by;
    IF NEW.status IS DISTINCT FROM OLD.status AND coalesce(current_setting('app.rfq_source', true),'') <> 'rpc' THEN
      RAISE EXCEPTION 'RFQ status can only change through workflow actions';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rfq_before_write BEFORE INSERT OR UPDATE ON public.rfqs FOR EACH ROW EXECUTE FUNCTION public.rfq_before_write();

-- Quotation items: compute amounts
CREATE OR REPLACE FUNCTION public.vqi_before_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT NEW.is_quoted THEN
    NEW.quoted_quantity := 0; NEW.rate := 0; NEW.discount_amount := 0;
    NEW.taxable_amount := 0; NEW.tax_amount := 0; NEW.line_total := 0;
  ELSE
    IF NEW.tax_type = 'none' THEN NEW.tax_rate_percent := 0; END IF;
    NEW.taxable_amount := round(greatest(NEW.quoted_quantity * NEW.rate - NEW.discount_amount, 0), 2);
    NEW.tax_amount := round(NEW.taxable_amount * NEW.tax_rate_percent / 100, 2);
    NEW.line_total := NEW.taxable_amount + NEW.tax_amount;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vqi_before_write BEFORE INSERT OR UPDATE ON public.vendor_quotation_items FOR EACH ROW EXECUTE FUNCTION public.vqi_before_write();

CREATE OR REPLACE FUNCTION public.vq_recompute(_qid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE vendor_quotations q SET
    subtotal = s.sub, discount_total = s.disc, tax_total = s.tax,
    grand_total = s.sub - s.disc + s.tax + q.freight + q.other_charges, updated_at = now()
  FROM (SELECT coalesce(sum(quoted_quantity*rate),0) sub, coalesce(sum(discount_amount),0) disc, coalesce(sum(tax_amount),0) tax
        FROM vendor_quotation_items WHERE quotation_id = _qid AND is_quoted) s
  WHERE q.id = _qid;
END $$;

CREATE OR REPLACE FUNCTION public.vqi_after_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM vq_recompute(coalesce(NEW.quotation_id, OLD.quotation_id));
  RETURN NULL;
END $$;
CREATE TRIGGER vqi_after_write AFTER INSERT OR UPDATE OR DELETE ON public.vendor_quotation_items FOR EACH ROW EXECUTE FUNCTION public.vqi_after_write();

CREATE OR REPLACE FUNCTION public.vq_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rv record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO rv FROM rfq_vendors WHERE id = NEW.rfq_vendor_id;
    IF rv IS NULL OR rv.rfq_id <> NEW.rfq_id THEN RAISE EXCEPTION 'Vendor is not invited to this RFQ'; END IF;
    NEW.vendor_id := rv.vendor_id;
    IF NEW.status NOT IN ('draft','submitted') THEN NEW.status := 'submitted'; END IF;
  ELSE
    NEW.rfq_id := OLD.rfq_id; NEW.rfq_vendor_id := OLD.rfq_vendor_id; NEW.vendor_id := OLD.vendor_id;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('selected','rejected')
       AND coalesce(current_setting('app.rfq_source', true),'') <> 'rpc' THEN
      RAISE EXCEPTION 'Quotation selection happens only through vendor selection';
    END IF;
    NEW.grand_total := NEW.subtotal - NEW.discount_total + NEW.tax_total + NEW.freight + NEW.other_charges;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vq_before_write BEFORE INSERT OR UPDATE ON public.vendor_quotations FOR EACH ROW EXECUTE FUNCTION public.vq_before_write();

-- After quotation insert/status change: update vendor response + RFQ status
CREATE OR REPLACE FUNCTION public.vq_after_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE total int; responded int; st rfq_status;
BEGIN
  IF NEW.status = 'submitted' THEN
    UPDATE rfq_vendors SET status = 'responded', responded_at = coalesce(responded_at, now()) WHERE id = NEW.rfq_vendor_id;
  END IF;
  SELECT status INTO st FROM rfqs WHERE id = NEW.rfq_id;
  IF st IN ('sent','partially_responded','fully_responded') THEN
    SELECT count(*), count(*) FILTER (WHERE status <> 'pending') INTO total, responded FROM rfq_vendors WHERE rfq_id = NEW.rfq_id;
    PERFORM set_config('app.rfq_source','rpc',true);
    UPDATE rfqs SET status = CASE WHEN responded >= total THEN 'fully_responded'::rfq_status
      WHEN responded > 0 THEN 'partially_responded'::rfq_status ELSE 'sent'::rfq_status END
    WHERE id = NEW.rfq_id;
    PERFORM set_config('app.rfq_source','',true);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER vq_after_write AFTER INSERT OR UPDATE OF status ON public.vendor_quotations FOR EACH ROW EXECUTE FUNCTION public.vq_after_write();

-- Workflow RPC
CREATE OR REPLACE FUNCTION public.rfq_transition(_rfq_id uuid, _action text, _comment text DEFAULT NULL) RETURNS rfq_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; ni int; nv int; ns rfq_status;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO r FROM rfqs WHERE id = _rfq_id FOR UPDATE;
  IF r IS NULL OR NOT can_access_project(auth.uid(), r.project_id) THEN RAISE EXCEPTION 'RFQ not found'; END IF;
  IF _action = 'send' THEN
    IF NOT has_permission(auth.uid(),'rfq.send') THEN RAISE EXCEPTION 'No permission to send RFQs'; END IF;
    IF r.status <> 'draft' THEN RAISE EXCEPTION 'Only draft RFQs can be sent'; END IF;
    SELECT count(*) INTO ni FROM rfq_items WHERE rfq_id = _rfq_id;
    SELECT count(*) INTO nv FROM rfq_vendors WHERE rfq_id = _rfq_id;
    IF ni = 0 THEN RAISE EXCEPTION 'Add at least one item'; END IF;
    IF nv = 0 THEN RAISE EXCEPTION 'Invite at least one vendor'; END IF;
    ns := 'sent';
  ELSIF _action = 'cancel' THEN
    IF NOT has_permission(auth.uid(),'rfq.cancel') THEN RAISE EXCEPTION 'No permission to cancel RFQs'; END IF;
    IF r.status IN ('ready_for_po','closed','cancelled') THEN RAISE EXCEPTION 'This RFQ can no longer be cancelled'; END IF;
    IF coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A reason is required to cancel'; END IF;
    ns := 'cancelled';
  ELSE
    RAISE EXCEPTION 'Unknown action';
  END IF;
  PERFORM set_config('app.rfq_source','rpc',true);
  UPDATE rfqs SET status = ns,
    sent_at = CASE WHEN ns = 'sent' THEN now() ELSE sent_at END,
    remarks = CASE WHEN ns = 'cancelled' THEN coalesce(remarks || E'\n','') || 'Cancelled: ' || _comment ELSE remarks END
  WHERE id = _rfq_id;
  PERFORM set_config('app.rfq_source','',true);
  RETURN ns;
END $$;

CREATE OR REPLACE FUNCTION public.rfq_mark_vendor_declined(_rfq_vendor_id uuid, _remarks text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rv record; total int; responded int;
BEGIN
  SELECT v.*, r.project_id, r.status rstatus INTO rv FROM rfq_vendors v JOIN rfqs r ON r.id = v.rfq_id WHERE v.id = _rfq_vendor_id;
  IF rv IS NULL OR NOT can_access_project(auth.uid(), rv.project_id) OR NOT has_permission(auth.uid(),'quotation.create') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF rv.rstatus NOT IN ('sent','partially_responded','fully_responded') THEN RAISE EXCEPTION 'RFQ is not open for responses'; END IF;
  IF rv.status <> 'pending' THEN RAISE EXCEPTION 'Vendor already responded'; END IF;
  UPDATE rfq_vendors SET status = 'declined', responded_at = now(), remarks = _remarks WHERE id = _rfq_vendor_id;
  SELECT count(*), count(*) FILTER (WHERE status <> 'pending') INTO total, responded FROM rfq_vendors WHERE rfq_id = rv.rfq_id;
  PERFORM set_config('app.rfq_source','rpc',true);
  UPDATE rfqs SET status = CASE WHEN responded >= total THEN 'fully_responded'::rfq_status ELSE 'partially_responded'::rfq_status END WHERE id = rv.rfq_id;
  PERFORM set_config('app.rfq_source','',true);
END $$;

-- Selection: _selections = [{rfq_item_id, quotation_item_id}]
CREATE OR REPLACE FUNCTION public.record_vendor_selection(_rfq_id uuid, _selections jsonb, _reason text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; s jsonb; qi record; n int := 0; total_items int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'quotation.select_vendor') THEN RAISE EXCEPTION 'No permission to select vendors'; END IF;
  SELECT * INTO r FROM rfqs WHERE id = _rfq_id FOR UPDATE;
  IF r IS NULL OR NOT can_access_project(auth.uid(), r.project_id) THEN RAISE EXCEPTION 'RFQ not found'; END IF;
  IF r.status NOT IN ('partially_responded','fully_responded') THEN RAISE EXCEPTION 'RFQ has no quotations open for selection'; END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A selection reason is required'; END IF;
  SELECT count(*) INTO total_items FROM rfq_items WHERE rfq_id = _rfq_id;
  IF jsonb_array_length(_selections) <> total_items THEN RAISE EXCEPTION 'Select a vendor for every item'; END IF;
  FOR s IN SELECT * FROM jsonb_array_elements(_selections) LOOP
    SELECT i.*, q.vendor_id, q.status qstatus, q.valid_until, q.rfq_id qrfq INTO qi
      FROM vendor_quotation_items i JOIN vendor_quotations q ON q.id = i.quotation_id
      WHERE i.id = (s->>'quotation_item_id')::uuid;
    IF qi IS NULL OR qi.qrfq <> _rfq_id OR qi.rfq_item_id <> (s->>'rfq_item_id')::uuid THEN RAISE EXCEPTION 'Invalid selection'; END IF;
    IF NOT qi.is_quoted THEN RAISE EXCEPTION 'Cannot select a vendor that did not quote the item'; END IF;
    IF qi.qstatus <> 'submitted' THEN RAISE EXCEPTION 'Quotation is not submitted'; END IF;
    IF qi.valid_until IS NOT NULL AND qi.valid_until < current_date THEN RAISE EXCEPTION 'A selected quotation has expired'; END IF;
    INSERT INTO vendor_selections(rfq_id, rfq_item_id, vendor_id, quotation_id, quotation_item_id, selected_quantity, awarded_rate, reason, selected_by)
      VALUES (_rfq_id, qi.rfq_item_id, qi.vendor_id, qi.quotation_id, qi.id, qi.quoted_quantity, qi.rate, _reason, auth.uid());
    n := n + 1;
  END LOOP;
  PERFORM set_config('app.rfq_source','rpc',true);
  UPDATE vendor_quotations SET status = 'selected' WHERE rfq_id = _rfq_id AND id IN (SELECT quotation_id FROM vendor_selections WHERE rfq_id = _rfq_id);
  UPDATE vendor_quotations SET status = 'rejected' WHERE rfq_id = _rfq_id AND status = 'submitted';
  UPDATE rfqs SET status = 'ready_for_po', selection_reason = _reason WHERE id = _rfq_id;
  PERFORM set_config('app.rfq_source','',true);
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION public.rfq_before_write(), public.vqi_after_write(), public.vq_before_write(), public.vq_after_write(), public.vq_recompute(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rfq_transition(uuid,text,text), public.record_vendor_selection(uuid,jsonb,text), public.rfq_mark_vendor_declined(uuid,text), public.rfq_can_view(uuid), public.rfq_can_edit_draft(uuid), public.rfq_can_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rfq_transition(uuid,text,text), public.record_vendor_selection(uuid,jsonb,text), public.rfq_mark_vendor_declined(uuid,text), public.rfq_can_view(uuid), public.rfq_can_edit_draft(uuid), public.rfq_can_quote(uuid) TO authenticated;

CREATE TRIGGER audit_rfqs AFTER INSERT OR UPDATE OR DELETE ON public.rfqs FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_vendor_quotations AFTER INSERT OR UPDATE OR DELETE ON public.vendor_quotations FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_vendor_selections AFTER INSERT OR UPDATE OR DELETE ON public.vendor_selections FOR EACH ROW EXECUTE FUNCTION public.audit_row();

INSERT INTO public.permissions(code, module, description, sort_order) VALUES
 ('rfq.view','procurement','View RFQs',300),
 ('rfq.create','procurement','Create RFQs from approved PRs',301),
 ('rfq.edit','procurement','Edit draft RFQs',302),
 ('rfq.send','procurement','Send RFQs to vendors',303),
 ('rfq.cancel','procurement','Cancel RFQs',304),
 ('quotation.view','procurement','View vendor quotations',310),
 ('quotation.create','procurement','Record vendor quotations',311),
 ('quotation.edit','procurement','Edit vendor quotations',312),
 ('quotation.compare','procurement','Compare quotations',313),
 ('quotation.select_vendor','procurement','Select / award vendors',314)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions(role, permission_code)
SELECT r::app_role, p FROM (VALUES
 ('director','rfq.view'),('director','rfq.create'),('director','rfq.edit'),('director','rfq.send'),('director','rfq.cancel'),
 ('director','quotation.view'),('director','quotation.create'),('director','quotation.edit'),('director','quotation.compare'),('director','quotation.select_vendor'),
 ('purchase_manager','rfq.view'),('purchase_manager','rfq.create'),('purchase_manager','rfq.edit'),('purchase_manager','rfq.send'),('purchase_manager','rfq.cancel'),
 ('purchase_manager','quotation.view'),('purchase_manager','quotation.create'),('purchase_manager','quotation.edit'),('purchase_manager','quotation.compare'),('purchase_manager','quotation.select_vendor'),
 ('project_manager','rfq.view'),('project_manager','rfq.create'),('project_manager','quotation.view'),('project_manager','quotation.compare'),
 ('site_engineer','rfq.view'),('store_manager','rfq.view'),
 ('accounts_manager','rfq.view'),('accounts_manager','quotation.view'),
 ('accountant','rfq.view'),('accountant','quotation.view'),
 ('auditor','rfq.view'),('auditor','quotation.view'),('auditor','quotation.compare')
) v(r,p)
ON CONFLICT DO NOTHING;