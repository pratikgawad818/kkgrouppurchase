CREATE TYPE public.grn_status AS ENUM ('draft','posted','cancelled');
CREATE TYPE public.adjustment_kind AS ENUM ('adjustment','opening_stock');

ALTER TABLE public.goods_receipt_items ADD COLUMN rejected_quantity numeric NOT NULL DEFAULT 0;
ALTER TABLE public.goods_receipt_notes
  ADD COLUMN status public.grn_status NOT NULL DEFAULT 'posted',
  ADD COLUMN building_id uuid REFERENCES public.buildings(id),
  ADD COLUMN rfq_id uuid REFERENCES public.rfqs(id),
  ADD COLUMN purchase_request_id uuid REFERENCES public.purchase_requests(id),
  ADD COLUMN posted_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES public.profiles(id),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancel_reason text;
UPDATE public.goods_receipt_notes g SET building_id = p.building_id, rfq_id = p.rfq_id, purchase_request_id = p.purchase_request_id, posted_at = g.created_at
  FROM public.purchase_orders p WHERE p.id = g.po_id;

CREATE TABLE public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_number text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  kind public.adjustment_kind NOT NULL,
  adjustment_date date NOT NULL DEFAULT current_date,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.stock_adjustment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id uuid NOT NULL REFERENCES public.stock_adjustments(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.items(id),
  system_quantity numeric NOT NULL DEFAULT 0,
  physical_quantity numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0
);
GRANT SELECT ON public.stock_adjustments, public.stock_adjustment_items TO authenticated;
GRANT ALL ON public.stock_adjustments, public.stock_adjustment_items TO service_role;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustment_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Inventory viewers read adjustments" ON public.stock_adjustments FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'inventory.view'));
CREATE POLICY "Inventory viewers read adjustment items" ON public.stock_adjustment_items FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'inventory.view'));
CREATE INDEX ON public.stock_adjustment_items(adjustment_id);

ALTER TABLE public.inventory_transactions
  ADD COLUMN building_id uuid REFERENCES public.buildings(id),
  ADD COLUMN adjustment_id uuid REFERENCES public.stock_adjustments(id);
UPDATE public.inventory_transactions t SET building_id = g.building_id FROM public.goods_receipt_notes g WHERE g.id = t.grn_id;

CREATE OR REPLACE FUNCTION public.post_stock_x(_company uuid, _type inventory_tx_type, _wh uuid, _mat uuid, _project uuid, _building uuid, _qin numeric, _qout numeric, _cost numeric, _grn uuid, _grn_item uuid, _transfer uuid, _adjustment uuid, _remarks text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; newq numeric; newcost numeric; usecost numeric;
BEGIN
  INSERT INTO warehouse_stock(warehouse_id, material_id) VALUES (_wh, _mat) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM warehouse_stock WHERE warehouse_id = _wh AND material_id = _mat FOR UPDATE;
  IF _qout > 0 THEN
    IF s.quantity_on_hand < _qout THEN RAISE EXCEPTION 'Insufficient stock in store (available %)', s.quantity_on_hand; END IF;
    usecost := coalesce(_cost, s.weighted_avg_cost); IF usecost = 0 THEN usecost := s.weighted_avg_cost; END IF;
    newq := s.quantity_on_hand - _qout;
    newcost := CASE WHEN newq > 0 THEN round(greatest(s.quantity_on_hand * s.weighted_avg_cost - _qout * usecost, 0) / newq, 4) ELSE 0 END;
    IF _type <> 'adjustment' OR _grn IS NULL THEN newcost := CASE WHEN newq > 0 THEN s.weighted_avg_cost ELSE 0 END; usecost := s.weighted_avg_cost; END IF;
  ELSE
    usecost := _cost; newq := s.quantity_on_hand + _qin;
    newcost := CASE WHEN newq > 0 THEN round((s.quantity_on_hand * s.weighted_avg_cost + _qin * _cost) / newq, 4) ELSE 0 END;
  END IF;
  UPDATE warehouse_stock SET quantity_on_hand = newq, weighted_avg_cost = newcost, total_value = round(newq * newcost, 2), updated_at = now()
    WHERE warehouse_id = _wh AND material_id = _mat;
  INSERT INTO inventory_transactions(company_id, tx_type, warehouse_id, material_id, project_id, building_id, quantity_in, quantity_out, unit_cost, total_cost, balance_after, grn_id, grn_item_id, transfer_id, adjustment_id, remarks, created_by)
    VALUES (_company, _type, _wh, _mat, _project, _building, _qin, _qout, usecost, round((_qin + _qout) * usecost, 2), newq, _grn, _grn_item, _transfer, _adjustment, _remarks, auth.uid());
  RETURN usecost;
END $$;

CREATE OR REPLACE FUNCTION public.post_stock(_company uuid, _type inventory_tx_type, _wh uuid, _mat uuid, _project uuid, _qin numeric, _qout numeric, _cost numeric, _grn uuid, _grn_item uuid, _transfer uuid, _remarks text)
RETURNS numeric LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.post_stock_x(_company, _type, _wh, _mat, _project, NULL, _qin, _qout, _cost, _grn, _grn_item, _transfer, NULL, _remarks);
$$;

CREATE OR REPLACE FUNCTION public.grn_apply(_grn_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; gi record; pi record; pending numeric;
BEGIN
  SELECT * INTO g FROM goods_receipt_notes WHERE id = _grn_id FOR UPDATE;
  FOR gi IN SELECT * FROM goods_receipt_items WHERE grn_id = _grn_id LOOP
    SELECT * INTO pi FROM purchase_order_items WHERE id = gi.po_item_id FOR UPDATE;
    IF pi.received_quantity + gi.received_quantity > pi.ordered_quantity THEN
      RAISE EXCEPTION 'Cannot receive %. Only % units remain pending.', gi.received_quantity, pi.ordered_quantity - pi.received_quantity;
    END IF;
    UPDATE goods_receipt_items SET previously_received = pi.received_quantity WHERE id = gi.id;
    UPDATE purchase_order_items SET received_quantity = received_quantity + gi.received_quantity WHERE id = pi.id;
    IF gi.accepted_quantity > 0 THEN
      PERFORM post_stock_x(g.company_id, 'goods_receipt', g.warehouse_id, gi.material_id, g.project_id, g.building_id, gi.accepted_quantity, 0, gi.unit_cost, g.id, gi.id, NULL, NULL, NULL);
    END IF;
  END LOOP;
  SELECT sum(ordered_quantity - received_quantity) INTO pending FROM purchase_order_items WHERE po_id = g.po_id;
  UPDATE purchase_orders SET status = CASE WHEN pending = 0 THEN 'fully_received'::po_status ELSE 'partially_received'::po_status END, updated_at = now() WHERE id = g.po_id;
  UPDATE goods_receipt_notes SET status = 'posted', posted_at = now() WHERE id = _grn_id;
END $$;

DROP FUNCTION public.create_goods_receipt(uuid, uuid, jsonb, jsonb);
CREATE FUNCTION public.create_goods_receipt(_po_id uuid, _warehouse_id uuid, _header jsonb, _items jsonb, _post boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; g uuid; it jsonb; pi record; rq numeric; dq numeric; jq numeric; cost numeric; n int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'grn.create') THEN RAISE EXCEPTION 'No permission to record goods receipts'; END IF;
  IF _post AND NOT has_permission(auth.uid(),'grn.post') THEN RAISE EXCEPTION 'No permission to post goods receipts'; END IF;
  SELECT * INTO p FROM purchase_orders WHERE id = _po_id FOR UPDATE;
  IF p IS NULL OR NOT can_access_project(auth.uid(), p.project_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF p.status NOT IN ('approved','sent','partially_received') THEN RAISE EXCEPTION 'Goods can only be received against approved or sent POs'; END IF;
  IF NOT EXISTS (SELECT 1 FROM warehouses WHERE id = _warehouse_id AND status = 'active') THEN RAISE EXCEPTION 'Invalid store'; END IF;
  INSERT INTO goods_receipt_notes(grn_number, company_id, po_id, vendor_id, project_id, building_id, rfq_id, purchase_request_id, warehouse_id, received_date, challan_number, invoice_reference, vehicle_number, remarks, received_by, status)
    VALUES (next_doc_number('grn','GRN'), p.company_id, p.id, p.vendor_id, p.project_id, p.building_id, p.rfq_id, p.purchase_request_id, _warehouse_id,
      coalesce(nullif(_header->>'received_date','')::date, current_date), nullif(_header->>'challan_number',''), nullif(_header->>'invoice_reference',''),
      nullif(_header->>'vehicle_number',''), nullif(_header->>'remarks',''), auth.uid(), 'draft')
    RETURNING id INTO g;
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    rq := coalesce((it->>'received_quantity')::numeric, 0); dq := coalesce((it->>'damaged_quantity')::numeric, 0); jq := coalesce((it->>'rejected_quantity')::numeric, 0);
    CONTINUE WHEN rq = 0;
    SELECT * INTO pi FROM purchase_order_items WHERE id = (it->>'po_item_id')::uuid AND po_id = _po_id;
    IF pi IS NULL THEN RAISE EXCEPTION 'Invalid PO line'; END IF;
    IF rq < 0 OR dq < 0 OR jq < 0 OR dq + jq > rq THEN RAISE EXCEPTION 'Invalid quantities on line %', pi.line_no; END IF;
    IF pi.received_quantity + rq > pi.ordered_quantity THEN
      RAISE EXCEPTION 'Cannot receive %. Only % units remain pending.', rq, pi.ordered_quantity - pi.received_quantity;
    END IF;
    cost := round(pi.taxable_amount / pi.ordered_quantity, 4);
    INSERT INTO goods_receipt_items(grn_id, po_item_id, material_id, unit_id, ordered_quantity, previously_received, received_quantity, damaged_quantity, rejected_quantity, accepted_quantity, unit_cost, remarks)
      VALUES (g, pi.id, pi.material_id, pi.unit_id, pi.ordered_quantity, pi.received_quantity, rq, dq, jq, rq - dq - jq, cost, nullif(it->>'remarks',''));
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'Enter a received quantity for at least one line'; END IF;
  IF _post THEN PERFORM grn_apply(g); END IF;
  RETURN g;
END $$;

CREATE OR REPLACE FUNCTION public.post_goods_receipt(_grn_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'grn.post') THEN RAISE EXCEPTION 'No permission to post goods receipts'; END IF;
  SELECT * INTO g FROM goods_receipt_notes WHERE id = _grn_id FOR UPDATE;
  IF g IS NULL OR NOT can_access_project(auth.uid(), g.project_id) THEN RAISE EXCEPTION 'GRN not found'; END IF;
  IF g.status <> 'draft' THEN RAISE EXCEPTION 'Only draft GRNs can be posted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id = g.po_id AND status IN ('approved','sent','partially_received')) THEN RAISE EXCEPTION 'The PO is no longer open for receipt'; END IF;
  PERFORM grn_apply(_grn_id);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_goods_receipt(_grn_id uuid, _reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; gi record; recv numeric; po record;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'grn.cancel') THEN RAISE EXCEPTION 'No permission to cancel goods receipts'; END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A cancellation reason is required'; END IF;
  SELECT * INTO g FROM goods_receipt_notes WHERE id = _grn_id FOR UPDATE;
  IF g IS NULL OR NOT can_access_project(auth.uid(), g.project_id) THEN RAISE EXCEPTION 'GRN not found'; END IF;
  IF g.status = 'cancelled' THEN RAISE EXCEPTION 'GRN is already cancelled'; END IF;
  SELECT * INTO po FROM purchase_orders WHERE id = g.po_id FOR UPDATE;
  IF po.status = 'closed' THEN RAISE EXCEPTION 'The PO is closed; GRN cannot be cancelled'; END IF;
  IF g.status = 'posted' THEN
    FOR gi IN SELECT * FROM goods_receipt_items WHERE grn_id = _grn_id LOOP
      UPDATE purchase_order_items SET received_quantity = received_quantity - gi.received_quantity WHERE id = gi.po_item_id;
      IF gi.accepted_quantity > 0 THEN
        PERFORM post_stock_x(g.company_id, 'adjustment', g.warehouse_id, gi.material_id, g.project_id, g.building_id, 0, gi.accepted_quantity, gi.unit_cost, g.id, gi.id, NULL, NULL, 'Reversal of ' || g.grn_number || ': ' || trim(_reason));
      END IF;
    END LOOP;
    SELECT sum(received_quantity) INTO recv FROM purchase_order_items WHERE po_id = g.po_id;
    UPDATE purchase_orders SET status = CASE
        WHEN recv = 0 THEN (CASE WHEN po.sent_at IS NOT NULL THEN 'sent' ELSE 'approved' END)::po_status
        WHEN recv < (SELECT sum(ordered_quantity) FROM purchase_order_items WHERE po_id = g.po_id) THEN 'partially_received'::po_status
        ELSE 'fully_received'::po_status END, updated_at = now()
      WHERE id = g.po_id;
  END IF;
  UPDATE goods_receipt_notes SET status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = trim(_reason) WHERE id = _grn_id;
END $$;

CREATE OR REPLACE FUNCTION public.create_stock_adjustment(_warehouse_id uuid, _kind adjustment_kind, _items jsonb, _reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c uuid; a uuid; it jsonb; m uuid; s record; sysq numeric; phys numeric; diff numeric; cost numeric; n int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'inventory.adjust') THEN RAISE EXCEPTION 'No permission to adjust stock'; END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT company_id INTO c FROM warehouses WHERE id = _warehouse_id AND status = 'active';
  IF c IS NULL THEN RAISE EXCEPTION 'Invalid store'; END IF;
  INSERT INTO stock_adjustments(adjustment_number, company_id, warehouse_id, kind, reason, created_by)
    VALUES (next_doc_number(CASE WHEN _kind = 'opening_stock' THEN 'os' ELSE 'adj' END, CASE WHEN _kind = 'opening_stock' THEN 'OS' ELSE 'ADJ' END), c, _warehouse_id, _kind, trim(_reason), auth.uid())
    RETURNING id INTO a;
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    m := (it->>'material_id')::uuid;
    CONTINUE WHEN m IS NULL;
    SELECT * INTO s FROM warehouse_stock WHERE warehouse_id = _warehouse_id AND material_id = m;
    sysq := coalesce(s.quantity_on_hand, 0);
    IF _kind = 'opening_stock' THEN
      diff := coalesce((it->>'quantity')::numeric, 0); cost := coalesce((it->>'unit_cost')::numeric, 0);
      CONTINUE WHEN diff <= 0;
      IF EXISTS (SELECT 1 FROM inventory_transactions WHERE warehouse_id = _warehouse_id AND material_id = m) THEN
        RAISE EXCEPTION 'Opening stock can only be entered for a material with no movements in this store';
      END IF;
      phys := diff;
      PERFORM post_stock_x(c, 'opening_stock', _warehouse_id, m, NULL, NULL, diff, 0, cost, NULL, NULL, NULL, a, trim(_reason));
    ELSE
      phys := (it->>'physical_quantity')::numeric;
      CONTINUE WHEN phys IS NULL OR phys < 0;
      diff := phys - sysq;
      CONTINUE WHEN diff = 0;
      cost := coalesce(s.weighted_avg_cost, 0);
      IF diff > 0 THEN PERFORM post_stock_x(c, 'adjustment', _warehouse_id, m, NULL, NULL, diff, 0, cost, NULL, NULL, NULL, a, trim(_reason));
      ELSE PERFORM post_stock_x(c, 'adjustment', _warehouse_id, m, NULL, NULL, 0, -diff, cost, NULL, NULL, NULL, a, trim(_reason)); END IF;
    END IF;
    INSERT INTO stock_adjustment_items(adjustment_id, material_id, system_quantity, physical_quantity, difference, unit_cost) VALUES (a, m, sysq, phys, diff, cost);
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'No changes to post'; END IF;
  RETURN a;
END $$;

REVOKE EXECUTE ON FUNCTION public.post_stock_x(uuid, inventory_tx_type, uuid, uuid, uuid, uuid, numeric, numeric, numeric, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_stock(uuid, inventory_tx_type, uuid, uuid, uuid, numeric, numeric, numeric, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grn_apply(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_goods_receipt(uuid, uuid, jsonb, jsonb, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.post_goods_receipt(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_goods_receipt(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_stock_adjustment(uuid, adjustment_kind, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_goods_receipt(uuid, uuid, jsonb, jsonb, boolean), public.post_goods_receipt(uuid), public.cancel_goods_receipt(uuid, text), public.create_stock_adjustment(uuid, adjustment_kind, jsonb, text) TO authenticated;

INSERT INTO public.permissions(code, module, description, sort_order) VALUES
 ('purchase_order.edit','purchase_orders','Edit draft purchase orders',305),
 ('purchase_order.submit','purchase_orders','Submit purchase orders for approval',306),
 ('purchase_order.reject','purchase_orders','Reject purchase orders',307),
 ('grn.edit_draft','inventory','Edit draft goods receipts',405),
 ('grn.post','inventory','Post goods receipts to stock',406),
 ('grn.cancel','inventory','Cancel goods receipts with reversal',407),
 ('inventory.receive','inventory','Receive material into stores',408),
 ('inventory.adjust','inventory','Adjust stock and enter opening stock',409)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.role_permissions(role, permission_code) VALUES
 ('director','purchase_order.edit'),('director','purchase_order.submit'),('director','purchase_order.reject'),
 ('director','grn.edit_draft'),('director','grn.post'),('director','grn.cancel'),('director','inventory.receive'),('director','inventory.adjust'),
 ('purchase_manager','purchase_order.edit'),('purchase_manager','purchase_order.submit'),('purchase_manager','purchase_order.reject'),
 ('purchase_manager','grn.post'),('purchase_manager','grn.cancel'),
 ('store_manager','grn.edit_draft'),('store_manager','grn.post'),('store_manager','inventory.receive'),('store_manager','inventory.adjust'),
 ('site_engineer','grn.edit_draft'),('site_engineer','inventory.receive')
ON CONFLICT DO NOTHING;

CREATE TRIGGER audit_stock_adjustments AFTER INSERT OR UPDATE OR DELETE ON public.stock_adjustments FOR EACH ROW EXECUTE FUNCTION public.audit_row();