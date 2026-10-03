CREATE TYPE public.po_status AS ENUM ('draft','pending_approval','approved','rejected','sent','partially_received','fully_received','closed','cancelled');
CREATE TYPE public.po_action AS ENUM ('created','submitted','approved','rejected','sent','cancelled','closed');
CREATE TYPE public.inventory_tx_type AS ENUM ('opening_stock','goods_receipt','transfer_in','transfer_out','damage','adjustment','material_issue','material_return','purchase_return');

CREATE TABLE public.doc_number_counters (doc text NOT NULL, year int NOT NULL, last_value int NOT NULL DEFAULT 0, PRIMARY KEY (doc, year));
GRANT ALL ON public.doc_number_counters TO service_role;
ALTER TABLE public.doc_number_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.next_doc_number(_doc text, _prefix text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE y int := extract(year from now())::int; v int;
BEGIN
  INSERT INTO doc_number_counters(doc, year, last_value) VALUES (_doc, y, 1)
  ON CONFLICT (doc, year) DO UPDATE SET last_value = doc_number_counters.last_value + 1
  RETURNING last_value INTO v;
  RETURN _prefix || '-' || y || '-' || lpad(v::text, 4, '0');
END $$;

CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  rfq_id uuid NOT NULL REFERENCES public.rfqs(id),
  quotation_id uuid NOT NULL REFERENCES public.vendor_quotations(id),
  purchase_request_id uuid NOT NULL REFERENCES public.purchase_requests(id),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  building_id uuid REFERENCES public.buildings(id),
  delivery_warehouse_id uuid REFERENCES public.warehouses(id),
  po_date date NOT NULL DEFAULT current_date,
  expected_delivery_date date,
  payment_terms text,
  delivery_terms text,
  remarks text,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_total numeric(14,2) NOT NULL DEFAULT 0,
  tax_total numeric(14,2) NOT NULL DEFAULT 0,
  freight numeric(14,2) NOT NULL DEFAULT 0,
  other_charges numeric(14,2) NOT NULL DEFAULT 0,
  grand_total numeric(14,2) NOT NULL DEFAULT 0,
  status public.po_status NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quotation_id)
);
CREATE INDEX ON public.purchase_orders(project_id); CREATE INDEX ON public.purchase_orders(vendor_id); CREATE INDEX ON public.purchase_orders(status);

CREATE TABLE public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  rfq_item_id uuid NOT NULL REFERENCES public.rfq_items(id),
  quotation_item_id uuid NOT NULL REFERENCES public.vendor_quotation_items(id),
  vendor_selection_id uuid NOT NULL REFERENCES public.vendor_selections(id),
  material_id uuid NOT NULL REFERENCES public.items(id),
  unit_id uuid NOT NULL REFERENCES public.units_of_measure(id),
  description text,
  ordered_quantity numeric(14,3) NOT NULL CHECK (ordered_quantity > 0),
  received_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  rate numeric(14,2) NOT NULL,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  taxable_amount numeric(14,2) NOT NULL,
  tax_type text NOT NULL,
  tax_rate_percent numeric(5,2) NOT NULL,
  tax_amount numeric(14,2) NOT NULL,
  line_total numeric(14,2) NOT NULL,
  CHECK (received_quantity <= ordered_quantity),
  UNIQUE (vendor_selection_id)
);
CREATE INDEX ON public.purchase_order_items(po_id);

CREATE TABLE public.purchase_order_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  action public.po_action NOT NULL,
  acted_by uuid REFERENCES public.profiles(id),
  acted_at timestamptz NOT NULL DEFAULT now(),
  comment text,
  previous_status public.po_status,
  new_status public.po_status
);
CREATE INDEX ON public.purchase_order_approvals(po_id);

CREATE TABLE public.goods_receipt_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  received_date date NOT NULL DEFAULT current_date,
  challan_number text,
  invoice_reference text,
  vehicle_number text,
  remarks text,
  received_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.goods_receipt_notes(po_id);

CREATE TABLE public.goods_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES public.goods_receipt_notes(id),
  po_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id),
  material_id uuid NOT NULL REFERENCES public.items(id),
  unit_id uuid NOT NULL REFERENCES public.units_of_measure(id),
  ordered_quantity numeric(14,3) NOT NULL,
  previously_received numeric(14,3) NOT NULL,
  received_quantity numeric(14,3) NOT NULL CHECK (received_quantity > 0),
  damaged_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
  accepted_quantity numeric(14,3) NOT NULL,
  unit_cost numeric(14,4) NOT NULL,
  remarks text,
  CHECK (accepted_quantity = received_quantity - damaged_quantity AND accepted_quantity >= 0)
);
CREATE INDEX ON public.goods_receipt_items(grn_id);

CREATE TABLE public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  from_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  to_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  transfer_date date NOT NULL DEFAULT current_date,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_warehouse_id <> to_warehouse_id)
);
CREATE TABLE public.stock_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.stock_transfers(id),
  material_id uuid NOT NULL REFERENCES public.items(id),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,4) NOT NULL
);

CREATE TABLE public.warehouse_stock (
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  material_id uuid NOT NULL REFERENCES public.items(id),
  quantity_on_hand numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  weighted_avg_cost numeric(14,4) NOT NULL DEFAULT 0,
  total_value numeric(16,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, material_id)
);

CREATE TABLE public.inventory_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  tx_date date NOT NULL DEFAULT current_date,
  tx_type public.inventory_tx_type NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  material_id uuid NOT NULL REFERENCES public.items(id),
  project_id uuid REFERENCES public.projects(id),
  quantity_in numeric(14,3) NOT NULL DEFAULT 0,
  quantity_out numeric(14,3) NOT NULL DEFAULT 0,
  unit_cost numeric(14,4) NOT NULL,
  total_cost numeric(16,2) NOT NULL,
  balance_after numeric(14,3) NOT NULL,
  grn_id uuid REFERENCES public.goods_receipt_notes(id),
  grn_item_id uuid REFERENCES public.goods_receipt_items(id),
  transfer_id uuid REFERENCES public.stock_transfers(id),
  remarks text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((quantity_in > 0 AND quantity_out = 0) OR (quantity_out > 0 AND quantity_in = 0))
);
CREATE INDEX ON public.inventory_transactions(warehouse_id, material_id);
CREATE INDEX ON public.inventory_transactions(created_at DESC);

GRANT SELECT ON public.purchase_orders, public.purchase_order_items, public.purchase_order_approvals, public.goods_receipt_notes, public.goods_receipt_items, public.stock_transfers, public.stock_transfer_items, public.warehouse_stock, public.inventory_transactions TO authenticated;
GRANT UPDATE (expected_delivery_date, payment_terms, delivery_terms, remarks, delivery_warehouse_id) ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders, public.purchase_order_items, public.purchase_order_approvals, public.goods_receipt_notes, public.goods_receipt_items, public.stock_transfers, public.stock_transfer_items, public.warehouse_stock, public.inventory_transactions TO service_role;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.po_can_view(_po_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM purchase_orders p WHERE p.id = _po_id
    AND (has_permission(auth.uid(),'purchase_order.view') OR has_permission(auth.uid(),'grn.view'))
    AND can_access_project(auth.uid(), p.project_id));
$$;

CREATE POLICY "View POs" ON public.purchase_orders FOR SELECT TO authenticated USING (po_can_view(id));
CREATE POLICY "Edit draft PO terms" ON public.purchase_orders FOR UPDATE TO authenticated
  USING (status = 'draft' AND has_permission(auth.uid(),'purchase_order.create') AND can_access_project(auth.uid(), project_id))
  WITH CHECK (status = 'draft');
CREATE POLICY "View PO items" ON public.purchase_order_items FOR SELECT TO authenticated USING (po_can_view(po_id));
CREATE POLICY "View PO approvals" ON public.purchase_order_approvals FOR SELECT TO authenticated USING (po_can_view(po_id));
CREATE POLICY "View GRNs" ON public.goods_receipt_notes FOR SELECT TO authenticated
  USING (has_permission(auth.uid(),'grn.view') AND can_access_project(auth.uid(), project_id));
CREATE POLICY "View GRN items" ON public.goods_receipt_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM goods_receipt_notes g WHERE g.id = grn_id AND has_permission(auth.uid(),'grn.view') AND can_access_project(auth.uid(), g.project_id)));
CREATE POLICY "View transfers" ON public.stock_transfers FOR SELECT TO authenticated USING (has_permission(auth.uid(),'inventory.view'));
CREATE POLICY "View transfer items" ON public.stock_transfer_items FOR SELECT TO authenticated USING (has_permission(auth.uid(),'inventory.view'));
CREATE POLICY "View stock" ON public.warehouse_stock FOR SELECT TO authenticated USING (has_permission(auth.uid(),'inventory.view'));
CREATE POLICY "View stock ledger" ON public.inventory_transactions FOR SELECT TO authenticated USING (has_permission(auth.uid(),'inventory.view'));

-- Stock posting helper (internal)
CREATE OR REPLACE FUNCTION public.post_stock(_company uuid, _type inventory_tx_type, _wh uuid, _mat uuid, _project uuid, _qin numeric, _qout numeric, _cost numeric, _grn uuid, _grn_item uuid, _transfer uuid, _remarks text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; newq numeric; newcost numeric; usecost numeric;
BEGIN
  INSERT INTO warehouse_stock(warehouse_id, material_id) VALUES (_wh, _mat) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM warehouse_stock WHERE warehouse_id = _wh AND material_id = _mat FOR UPDATE;
  IF _qout > 0 THEN
    IF s.quantity_on_hand < _qout THEN RAISE EXCEPTION 'Insufficient stock for material in source store (available %)', s.quantity_on_hand; END IF;
    usecost := s.weighted_avg_cost; newq := s.quantity_on_hand - _qout; newcost := s.weighted_avg_cost;
  ELSE
    usecost := _cost; newq := s.quantity_on_hand + _qin;
    newcost := CASE WHEN newq > 0 THEN round((s.quantity_on_hand * s.weighted_avg_cost + _qin * _cost) / newq, 4) ELSE 0 END;
  END IF;
  UPDATE warehouse_stock SET quantity_on_hand = newq, weighted_avg_cost = newcost, total_value = round(newq * newcost, 2), updated_at = now()
    WHERE warehouse_id = _wh AND material_id = _mat;
  INSERT INTO inventory_transactions(company_id, tx_type, warehouse_id, material_id, project_id, quantity_in, quantity_out, unit_cost, total_cost, balance_after, grn_id, grn_item_id, transfer_id, remarks, created_by)
    VALUES (_company, _type, _wh, _mat, _project, _qin, _qout, usecost, round((_qin + _qout) * usecost, 2), newq, _grn, _grn_item, _transfer, _remarks, auth.uid());
  RETURN usecost;
END $$;

CREATE OR REPLACE FUNCTION public.create_po_from_selection(_rfq_id uuid, _quotation_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; q record; po uuid; n int := 0; s record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'purchase_order.create') THEN RAISE EXCEPTION 'No permission to create purchase orders'; END IF;
  SELECT * INTO r FROM rfqs WHERE id = _rfq_id FOR UPDATE;
  IF r IS NULL OR NOT can_access_project(auth.uid(), r.project_id) THEN RAISE EXCEPTION 'RFQ not found'; END IF;
  IF r.status <> 'ready_for_po' THEN RAISE EXCEPTION 'RFQ is not ready for purchase order'; END IF;
  SELECT * INTO q FROM vendor_quotations WHERE id = _quotation_id AND rfq_id = _rfq_id AND status = 'selected';
  IF q IS NULL THEN RAISE EXCEPTION 'Quotation was not awarded on this RFQ'; END IF;
  IF EXISTS (SELECT 1 FROM purchase_orders WHERE quotation_id = _quotation_id AND status <> 'cancelled') THEN RAISE EXCEPTION 'A purchase order already exists for this vendor award'; END IF;
  IF EXISTS (SELECT 1 FROM purchase_orders WHERE quotation_id = _quotation_id) THEN RAISE EXCEPTION 'The PO for this award was cancelled; awards cannot be reused'; END IF;
  INSERT INTO purchase_orders(po_number, company_id, rfq_id, quotation_id, purchase_request_id, vendor_id, project_id, building_id, expected_delivery_date, payment_terms, freight, other_charges, created_by)
    VALUES (next_doc_number('po','PO'), r.company_id, r.id, q.id, r.purchase_request_id, q.vendor_id, r.project_id, r.building_id,
            CASE WHEN q.delivery_days IS NOT NULL THEN current_date + q.delivery_days ELSE r.required_by_date END,
            q.payment_terms, q.freight, q.other_charges, auth.uid())
    RETURNING id INTO po;
  FOR s IN SELECT vs.id vsid, vs.selected_quantity, i.*, ri.material_id, ri.unit_id, ri.description rdesc
      FROM vendor_selections vs JOIN vendor_quotation_items i ON i.id = vs.quotation_item_id JOIN rfq_items ri ON ri.id = vs.rfq_item_id
      WHERE vs.quotation_id = q.id ORDER BY ri.line_no LOOP
    n := n + 1;
    INSERT INTO purchase_order_items(po_id, line_no, rfq_item_id, quotation_item_id, vendor_selection_id, material_id, unit_id, description, ordered_quantity, rate, discount_amount, taxable_amount, tax_type, tax_rate_percent, tax_amount, line_total)
      VALUES (po, n, s.rfq_item_id, s.id, s.vsid, s.material_id, s.unit_id, s.rdesc, s.selected_quantity, s.rate, s.discount_amount, s.taxable_amount, s.tax_type, s.tax_rate_percent, s.tax_amount, s.line_total);
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'No awarded items for this vendor'; END IF;
  UPDATE purchase_orders p SET subtotal = t.sub, discount_total = t.disc, tax_total = t.tax, grand_total = t.tot + p.freight + p.other_charges
    FROM (SELECT sum(rate*ordered_quantity) sub, sum(discount_amount) disc, sum(tax_amount) tax, sum(line_total) tot FROM purchase_order_items WHERE po_id = po) t
    WHERE p.id = po;
  INSERT INTO purchase_order_approvals(po_id, action, acted_by, new_status) VALUES (po, 'created', auth.uid(), 'draft');
  RETURN po;
END $$;

CREATE OR REPLACE FUNCTION public.po_transition(_po_id uuid, _action po_action, _comment text) RETURNS po_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; nxt po_status;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO p FROM purchase_orders WHERE id = _po_id FOR UPDATE;
  IF p IS NULL OR NOT can_access_project(auth.uid(), p.project_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF _action = 'submitted' THEN
    IF NOT has_permission(auth.uid(),'purchase_order.create') THEN RAISE EXCEPTION 'No permission'; END IF;
    IF p.status NOT IN ('draft','rejected') THEN RAISE EXCEPTION 'Only draft or rejected POs can be submitted'; END IF;
    IF p.delivery_warehouse_id IS NULL THEN RAISE EXCEPTION 'Choose a delivery store before submitting'; END IF;
    nxt := 'pending_approval';
  ELSIF _action IN ('approved','rejected') THEN
    IF NOT has_permission(auth.uid(),'purchase_order.approve') THEN RAISE EXCEPTION 'No permission to approve purchase orders'; END IF;
    IF p.status <> 'pending_approval' THEN RAISE EXCEPTION 'PO is not pending approval'; END IF;
    IF p.created_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve or reject a PO you created'; END IF;
    IF _action = 'rejected' AND coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
    nxt := CASE WHEN _action = 'approved' THEN 'approved' ELSE 'rejected' END;
  ELSIF _action = 'sent' THEN
    IF NOT has_permission(auth.uid(),'purchase_order.create') THEN RAISE EXCEPTION 'No permission'; END IF;
    IF p.status <> 'approved' THEN RAISE EXCEPTION 'Only approved POs can be marked as sent'; END IF;
    nxt := 'sent';
  ELSIF _action = 'cancelled' THEN
    IF NOT has_permission(auth.uid(),'purchase_order.cancel') THEN RAISE EXCEPTION 'No permission to cancel'; END IF;
    IF p.status NOT IN ('draft','pending_approval','approved','rejected','sent') THEN RAISE EXCEPTION 'PO cannot be cancelled once goods are received'; END IF;
    IF EXISTS (SELECT 1 FROM goods_receipt_notes WHERE po_id = _po_id) THEN RAISE EXCEPTION 'PO has goods receipts'; END IF;
    IF coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A cancellation reason is required'; END IF;
    nxt := 'cancelled';
  ELSIF _action = 'closed' THEN
    IF NOT has_permission(auth.uid(),'purchase_order.approve') THEN RAISE EXCEPTION 'No permission'; END IF;
    IF p.status NOT IN ('partially_received','fully_received') THEN RAISE EXCEPTION 'Only received POs can be closed'; END IF;
    IF p.status = 'partially_received' AND coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A reason is required to short-close a PO'; END IF;
    nxt := 'closed';
  ELSE RAISE EXCEPTION 'Invalid action'; END IF;
  UPDATE purchase_orders SET status = nxt, updated_at = now(),
    approved_by = CASE WHEN nxt = 'approved' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN nxt = 'approved' THEN now() ELSE approved_at END,
    sent_at = CASE WHEN nxt = 'sent' THEN now() ELSE sent_at END
    WHERE id = _po_id;
  INSERT INTO purchase_order_approvals(po_id, action, acted_by, comment, previous_status, new_status) VALUES (_po_id, _action, auth.uid(), nullif(trim(_comment),''), p.status, nxt);
  RETURN nxt;
END $$;

CREATE OR REPLACE FUNCTION public.create_goods_receipt(_po_id uuid, _warehouse_id uuid, _header jsonb, _items jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; g uuid; it jsonb; pi record; rq numeric; dq numeric; cost numeric; gi uuid; n int := 0; pending numeric; prev po_status;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'grn.create') THEN RAISE EXCEPTION 'No permission to record goods receipts'; END IF;
  SELECT * INTO p FROM purchase_orders WHERE id = _po_id FOR UPDATE;
  IF p IS NULL OR NOT can_access_project(auth.uid(), p.project_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF p.status NOT IN ('approved','sent','partially_received') THEN RAISE EXCEPTION 'Goods can only be received against approved or sent POs'; END IF;
  IF NOT EXISTS (SELECT 1 FROM warehouses WHERE id = _warehouse_id AND status = 'active') THEN RAISE EXCEPTION 'Invalid store'; END IF;
  INSERT INTO goods_receipt_notes(grn_number, company_id, po_id, vendor_id, project_id, warehouse_id, received_date, challan_number, invoice_reference, vehicle_number, remarks, received_by)
    VALUES (next_doc_number('grn','GRN'), p.company_id, p.id, p.vendor_id, p.project_id, _warehouse_id,
      coalesce(nullif(_header->>'received_date','')::date, current_date), nullif(_header->>'challan_number',''), nullif(_header->>'invoice_reference',''),
      nullif(_header->>'vehicle_number',''), nullif(_header->>'remarks',''), auth.uid())
    RETURNING id INTO g;
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    rq := coalesce((it->>'received_quantity')::numeric, 0); dq := coalesce((it->>'damaged_quantity')::numeric, 0);
    CONTINUE WHEN rq = 0;
    SELECT * INTO pi FROM purchase_order_items WHERE id = (it->>'po_item_id')::uuid AND po_id = _po_id FOR UPDATE;
    IF pi IS NULL THEN RAISE EXCEPTION 'Invalid PO line'; END IF;
    IF rq < 0 OR dq < 0 OR dq > rq THEN RAISE EXCEPTION 'Invalid quantities on line %', pi.line_no; END IF;
    IF pi.received_quantity + rq > pi.ordered_quantity THEN RAISE EXCEPTION 'Line % would exceed the ordered quantity (pending %)', pi.line_no, pi.ordered_quantity - pi.received_quantity; END IF;
    cost := round(pi.taxable_amount / pi.ordered_quantity, 4);
    INSERT INTO goods_receipt_items(grn_id, po_item_id, material_id, unit_id, ordered_quantity, previously_received, received_quantity, damaged_quantity, accepted_quantity, unit_cost, remarks)
      VALUES (g, pi.id, pi.material_id, pi.unit_id, pi.ordered_quantity, pi.received_quantity, rq, dq, rq - dq, cost, nullif(it->>'remarks',''))
      RETURNING id INTO gi;
    UPDATE purchase_order_items SET received_quantity = received_quantity + rq WHERE id = pi.id;
    IF rq - dq > 0 THEN
      PERFORM post_stock(p.company_id, 'goods_receipt', _warehouse_id, pi.material_id, p.project_id, rq - dq, 0, cost, g, gi, NULL, NULL);
    END IF;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'Enter a received quantity for at least one line'; END IF;
  SELECT sum(ordered_quantity - received_quantity) INTO pending FROM purchase_order_items WHERE po_id = _po_id;
  prev := p.status;
  UPDATE purchase_orders SET status = CASE WHEN pending = 0 THEN 'fully_received'::po_status ELSE 'partially_received'::po_status END, updated_at = now() WHERE id = _po_id;
  RETURN g;
END $$;

CREATE OR REPLACE FUNCTION public.execute_stock_transfer(_from uuid, _to uuid, _items jsonb, _reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid; it jsonb; c uuid; q numeric; cost numeric; n int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'inventory.transfer') THEN RAISE EXCEPTION 'No permission to transfer stock'; END IF;
  IF _from = _to THEN RAISE EXCEPTION 'Source and destination must differ'; END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT company_id INTO c FROM warehouses WHERE id = _from AND status = 'active';
  IF c IS NULL OR NOT EXISTS (SELECT 1 FROM warehouses WHERE id = _to AND status = 'active' AND company_id = c) THEN RAISE EXCEPTION 'Invalid stores'; END IF;
  INSERT INTO stock_transfers(transfer_number, company_id, from_warehouse_id, to_warehouse_id, reason, created_by)
    VALUES (next_doc_number('st','ST'), c, _from, _to, trim(_reason), auth.uid()) RETURNING id INTO t;
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    q := (it->>'quantity')::numeric;
    CONTINUE WHEN q IS NULL OR q <= 0;
    cost := post_stock(c, 'transfer_out', _from, (it->>'material_id')::uuid, NULL, 0, q, 0, NULL, NULL, t, NULL);
    PERFORM post_stock(c, 'transfer_in', _to, (it->>'material_id')::uuid, NULL, q, 0, cost, NULL, NULL, t, NULL);
    INSERT INTO stock_transfer_items(transfer_id, material_id, quantity, unit_cost) VALUES (t, (it->>'material_id')::uuid, q, cost);
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'Add at least one material'; END IF;
  RETURN t;
END $$;

REVOKE EXECUTE ON FUNCTION public.next_doc_number(text,text), public.post_stock(uuid,inventory_tx_type,uuid,uuid,uuid,numeric,numeric,numeric,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_po_from_selection(uuid,uuid), public.po_transition(uuid,po_action,text), public.create_goods_receipt(uuid,uuid,jsonb,jsonb), public.execute_stock_transfer(uuid,uuid,jsonb,text), public.po_can_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_po_from_selection(uuid,uuid), public.po_transition(uuid,po_action,text), public.create_goods_receipt(uuid,uuid,jsonb,jsonb), public.execute_stock_transfer(uuid,uuid,jsonb,text), public.po_can_view(uuid) TO authenticated;

CREATE TRIGGER audit_purchase_orders AFTER INSERT OR UPDATE OR DELETE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_grn AFTER INSERT OR UPDATE OR DELETE ON public.goods_receipt_notes FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_stock_transfers AFTER INSERT OR UPDATE OR DELETE ON public.stock_transfers FOR EACH ROW EXECUTE FUNCTION public.audit_row();

INSERT INTO public.permissions(code, module, description, sort_order) VALUES
 ('purchase_order.view','procurement','View purchase orders',400),
 ('purchase_order.create','procurement','Create, submit and send purchase orders',401),
 ('purchase_order.approve','procurement','Approve, reject and close purchase orders',402),
 ('purchase_order.cancel','procurement','Cancel purchase orders',403),
 ('grn.view','inventory','View goods receipts',410),
 ('grn.create','inventory','Record goods receipts',411),
 ('inventory.view','inventory','View stock and stock ledger',420),
 ('inventory.transfer','inventory','Transfer stock between stores',421)
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions(role, permission_code)
SELECT r::app_role, p FROM (VALUES
 ('director','purchase_order.view'),('director','purchase_order.create'),('director','purchase_order.approve'),('director','purchase_order.cancel'),('director','grn.view'),('director','grn.create'),('director','inventory.view'),('director','inventory.transfer'),
 ('purchase_manager','purchase_order.view'),('purchase_manager','purchase_order.create'),('purchase_manager','purchase_order.approve'),('purchase_manager','purchase_order.cancel'),('purchase_manager','grn.view'),('purchase_manager','inventory.view'),
 ('store_manager','purchase_order.view'),('store_manager','grn.view'),('store_manager','grn.create'),('store_manager','inventory.view'),('store_manager','inventory.transfer'),
 ('project_manager','purchase_order.view'),('project_manager','grn.view'),('project_manager','inventory.view'),
 ('site_engineer','purchase_order.view'),('site_engineer','grn.view'),('site_engineer','grn.create'),('site_engineer','inventory.view'),
 ('accounts_manager','purchase_order.view'),('accounts_manager','grn.view'),('accounts_manager','inventory.view'),
 ('accountant','purchase_order.view'),('accountant','grn.view'),('accountant','inventory.view'),
 ('auditor','purchase_order.view'),('auditor','grn.view'),('auditor','inventory.view')
) v(r,p) ON CONFLICT DO NOTHING;