-- Standalone vendor delivery challan register.
-- Supplier dispatch evidence is captured independently from goods receipt.
-- No stock or payable movement is caused by registering a challan.
-- Requires migrations through 0013; apply in staging and validate RLS first.

CREATE TABLE public.vendor_delivery_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  building_id uuid REFERENCES public.buildings(id),
  challan_number text NOT NULL CHECK (length(btrim(challan_number)) BETWEEN 1 AND 100),
  challan_date date NOT NULL,
  vehicle_number text,
  invoice_reference text,
  remarks text,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','cancelled')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_by uuid REFERENCES public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  UNIQUE (company_id, vendor_id, challan_number)
);
CREATE INDEX vendor_delivery_challans_po_idx ON public.vendor_delivery_challans(po_id);
CREATE INDEX vendor_delivery_challans_project_idx ON public.vendor_delivery_challans(project_id, created_at DESC);

CREATE TABLE public.vendor_delivery_challan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id uuid NOT NULL REFERENCES public.vendor_delivery_challans(id) ON DELETE RESTRICT,
  po_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  UNIQUE(challan_id,po_item_id)
);
CREATE INDEX vendor_delivery_challan_items_po_idx ON public.vendor_delivery_challan_items(po_item_id);

ALTER TABLE public.goods_receipt_notes
  ADD COLUMN challan_id uuid REFERENCES public.vendor_delivery_challans(id);

ALTER TABLE public.goods_receipt_items
  ADD CONSTRAINT goods_receipt_items_challan_item_fk
  FOREIGN KEY (challan_item_id) REFERENCES public.vendor_delivery_challan_items(id);

CREATE INDEX goods_receipt_notes_challan_idx ON public.goods_receipt_notes(challan_id);
CREATE INDEX goods_receipt_items_challan_line_idx ON public.goods_receipt_items(challan_item_id);

ALTER TABLE public.vendor_delivery_challans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_delivery_challan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project users view vendor challans"
  ON public.vendor_delivery_challans FOR SELECT TO authenticated
  USING (
    (public.has_permission(auth.uid(),'grn.view') OR public.has_permission(auth.uid(),'purchase_order.view'))
    AND public.can_access_project(auth.uid(), project_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles viewer
      WHERE viewer.id=auth.uid() AND viewer.is_active AND viewer.company_id=vendor_delivery_challans.company_id
    )
  );

CREATE POLICY "Project users view challan lines"
  ON public.vendor_delivery_challan_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vendor_delivery_challans h
      WHERE h.id = challan_id
    )
  );

GRANT SELECT ON public.vendor_delivery_challans, public.vendor_delivery_challan_items TO authenticated;
GRANT ALL ON public.vendor_delivery_challans, public.vendor_delivery_challan_items TO service_role;

-- Only server-side RPCs write challan headers and lines: no authenticated write RLS policies.
CREATE OR REPLACE FUNCTION public.register_vendor_delivery_challan(_po_id uuid, _header jsonb, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p record; dc_id uuid; dc_number text; dc_date date; line jsonb; poi record; qty numeric; n integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(),'grn.create') THEN
    RAISE EXCEPTION 'No permission to register delivery challans';
  END IF;
  SELECT * INTO p FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
  IF p IS NULL OR NOT public.can_access_project(auth.uid(), p.project_id) THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles v WHERE v.id=auth.uid() AND v.is_active AND v.company_id=p.company_id) THEN
    RAISE EXCEPTION 'Not authorised for this company';
  END IF;
  IF p.status NOT IN ('approved','sent','partially_received','partially_accepted') THEN
    RAISE EXCEPTION 'Only open approved purchase orders can receive supplier challans';
  END IF;
  dc_number := btrim(coalesce(_header->>'challan_number',''));
  IF length(dc_number) < 1 OR length(dc_number) > 100 THEN
    RAISE EXCEPTION 'Enter the vendor delivery challan number (max 100 characters)';
  END IF;
  dc_date := nullif(_header->>'challan_date','')::date;
  IF dc_date IS NULL OR dc_date > public.ist_today() THEN
    RAISE EXCEPTION 'Enter a valid challan date, not in the future';
  END IF;
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Challan lines must be an array';
  END IF;
  INSERT INTO public.vendor_delivery_challans (
    company_id,po_id,vendor_id,project_id,building_id,challan_number,challan_date,
    vehicle_number,invoice_reference,remarks,created_by
  ) VALUES (
    p.company_id,p.id,p.vendor_id,p.project_id,p.building_id,dc_number,dc_date,
    nullif(btrim(_header->>'vehicle_number'),''),
    nullif(btrim(_header->>'invoice_reference'),''),
    nullif(btrim(_header->>'remarks'),''),
    auth.uid()
  ) RETURNING id INTO dc_id;
  FOR line IN SELECT * FROM jsonb_array_elements(_items) LOOP
    qty := nullif(line->>'quantity','')::numeric;
    IF qty IS NULL OR qty <= 0 THEN RAISE EXCEPTION 'Each challan line needs a positive quantity'; END IF;
    SELECT * INTO poi FROM public.purchase_order_items
      WHERE id=(line->>'po_item_id')::uuid AND po_id=_po_id;
    IF poi IS NULL THEN RAISE EXCEPTION 'A challan line is not on this purchase order'; END IF;
    IF qty > poi.ordered_quantity THEN
      RAISE EXCEPTION 'Delivery quantity on line % cannot exceed original PO quantity %',poi.line_no,poi.ordered_quantity;
    END IF;
    INSERT INTO public.vendor_delivery_challan_items (challan_id,po_item_id,quantity)
      VALUES (dc_id,poi.id,qty);
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'Add at least one dispatched line'; END IF;
  PERFORM public.log_event('delivery_challan_registered','Delivery Challan',dc_number,dc_id,NULL,NULL,
    jsonb_build_object('po_id',_po_id,'items',n),'purchase_order',_po_id);
  RETURN dc_id;
END $$;
REVOKE ALL ON FUNCTION public.register_vendor_delivery_challan(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_vendor_delivery_challan(uuid,jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_vendor_delivery_challan(_id uuid,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE dc record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(),'grn.create') THEN
    RAISE EXCEPTION 'No permission to cancel supplier challans';
  END IF;
  IF btrim(coalesce(_reason,'')) = '' THEN RAISE EXCEPTION 'A cancellation reason is required'; END IF;
  SELECT * INTO dc FROM public.vendor_delivery_challans WHERE id=_id FOR UPDATE;
  IF dc IS NULL OR NOT public.can_access_project(auth.uid(),dc.project_id) THEN
    RAISE EXCEPTION 'Delivery challan not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles v WHERE v.id=auth.uid() AND v.is_active AND v.company_id=dc.company_id) THEN
    RAISE EXCEPTION 'Not authorised for this company';
  END IF;
  IF dc.status <> 'registered' THEN RAISE EXCEPTION 'Challan is already cancelled'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.goods_receipt_notes
    WHERE challan_id=_id AND status <> 'cancelled'
  ) THEN RAISE EXCEPTION 'Cannot cancel a challan used by a live GRN; cancel the GRN first'; END IF;
  UPDATE public.vendor_delivery_challans SET status='cancelled',cancelled_by=auth.uid(),
    cancelled_at=now(),cancel_reason=btrim(_reason) WHERE id=_id;
  PERFORM public.log_event('delivery_challan_cancelled','Delivery Challan',dc.challan_number,dc.id,
    _reason,jsonb_build_object('status','registered'),jsonb_build_object('status','cancelled'),'purchase_order',dc.po_id);
END $$;
REVOKE ALL ON FUNCTION public.cancel_vendor_delivery_challan(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_vendor_delivery_challan(uuid,text) TO authenticated;

-- Preserve the existing five-argument GRN API. When a challan is supplied,
-- validate every material and its remaining dispatch quantity under a row lock.
-- Legacy unmatched GRNs remain visible; the new user interface requires a registered challan.
CREATE OR REPLACE FUNCTION public.create_goods_receipt(_po_id uuid, _warehouse_id uuid, _header jsonb, _items jsonb, _post boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; g uuid; gnum text; it jsonb; pi record; rq numeric; dq numeric; jq numeric; cost numeric; n int := 0; remaining numeric; disp grn_disposition; rdate date; dc record; dci record; used_qty numeric; requested_dc uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'grn.create') THEN RAISE EXCEPTION 'No permission to record goods receipts'; END IF;
  IF _post AND NOT has_permission(auth.uid(),'grn.post') THEN RAISE EXCEPTION 'No permission to post goods receipts'; END IF;
  SELECT * INTO p FROM purchase_orders WHERE id = _po_id FOR UPDATE;
  IF p IS NULL OR NOT can_access_project(auth.uid(), p.project_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF p.status NOT IN ('approved','sent','partially_received','partially_accepted') THEN RAISE EXCEPTION 'Goods can only be received against open approved or sent POs'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM warehouses
    WHERE id = _warehouse_id AND status = 'active'
      AND company_id = p.company_id
      AND (project_id IS NULL OR project_id = p.project_id)
  ) THEN RAISE EXCEPTION 'Receiving store must belong to this company and project'; END IF;
  requested_dc := nullif(_header->>'challan_id','')::uuid;
  IF requested_dc IS NOT NULL THEN
    SELECT * INTO dc FROM vendor_delivery_challans WHERE id=requested_dc FOR UPDATE;
    IF dc IS NULL OR dc.status <> 'registered' OR dc.po_id <> _po_id
       OR dc.company_id <> p.company_id OR dc.vendor_id <> p.vendor_id THEN
      RAISE EXCEPTION 'Invalid or cancelled delivery challan for this purchase order';
    END IF;
  END IF;
  rdate := coalesce(nullif(_header->>'received_date','')::date, ist_today());
  IF rdate > ist_today() THEN RAISE EXCEPTION 'Received date cannot be in the future'; END IF;
  IF requested_dc IS NOT NULL AND rdate < dc.challan_date THEN
    RAISE EXCEPTION 'GRN date cannot precede the supplier challan date';
  END IF;
  gnum := next_doc_number('grn','GRN');
  INSERT INTO goods_receipt_notes(grn_number, company_id, po_id, vendor_id, project_id, building_id, rfq_id, purchase_request_id, warehouse_id, received_date, challan_id, challan_number, invoice_reference, vehicle_number, remarks, received_by, status)
    VALUES (gnum, p.company_id, p.id, p.vendor_id, p.project_id, p.building_id, p.rfq_id, p.purchase_request_id, _warehouse_id,
      rdate, requested_dc, CASE WHEN requested_dc IS NOT NULL THEN dc.challan_number ELSE nullif(_header->>'challan_number','') END, nullif(_header->>'invoice_reference',''),
      nullif(_header->>'vehicle_number',''), nullif(_header->>'remarks',''), auth.uid(), 'draft')
    RETURNING id INTO g;
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    rq := coalesce((it->>'received_quantity')::numeric, 0); dq := coalesce((it->>'damaged_quantity')::numeric, 0); jq := coalesce((it->>'rejected_quantity')::numeric, 0);
    CONTINUE WHEN rq = 0;
    SELECT * INTO pi FROM purchase_order_items WHERE id = (it->>'po_item_id')::uuid AND po_id = _po_id;
    IF pi IS NULL THEN RAISE EXCEPTION 'Invalid PO line'; END IF;
    IF rq < 0 OR dq < 0 OR jq < 0 OR dq + jq > rq THEN RAISE EXCEPTION 'Invalid quantities on line %', pi.line_no; END IF;
    IF requested_dc IS NOT NULL THEN
      SELECT * INTO dci
      FROM vendor_delivery_challan_items WHERE challan_id=requested_dc AND po_item_id=pi.id FOR UPDATE;
      IF dci IS NULL THEN RAISE EXCEPTION 'PO line % is not listed on this delivery challan', pi.line_no; END IF;
      SELECT coalesce(sum(gi.received_quantity),0) INTO used_qty
      FROM goods_receipt_items gi
      JOIN goods_receipt_notes gr ON gr.id=gi.grn_id
      WHERE gi.challan_item_id=dci.id AND gr.status <> 'cancelled';
      IF used_qty + rq > dci.quantity THEN
        RAISE EXCEPTION 'Challan line % allows % remaining. This receipt requests %.',
          pi.line_no, dci.quantity - used_qty, rq;
      END IF;
    END IF;
    remaining := pi.ordered_quantity - pi.accepted_quantity - pi.short_closed_quantity;
    IF rq > remaining THEN RAISE EXCEPTION 'Cannot receive %. Only % units remain pending.', rq, remaining; END IF;
    disp := coalesce(nullif(it->>'disposition','')::grn_disposition, 'pending_decision');
    IF disp NOT IN ('pending_decision','replacement_expected') THEN disp := 'pending_decision'; END IF;
    IF dq + jq = 0 THEN disp := 'pending_decision'; END IF;
    cost := round(pi.taxable_amount / pi.ordered_quantity, 4);
    INSERT INTO goods_receipt_items(grn_id, po_item_id, material_id, unit_id, ordered_quantity, previously_received, received_quantity, damaged_quantity, rejected_quantity, accepted_quantity, unit_cost, remarks, disposition, disposition_by, disposition_at, challan_item_id)
      VALUES (g, pi.id, pi.material_id, pi.unit_id, pi.ordered_quantity, pi.accepted_quantity, rq, dq, jq, rq - dq - jq, cost, nullif(it->>'remarks',''),
              disp, CASE WHEN dq + jq > 0 THEN auth.uid() END, CASE WHEN dq + jq > 0 THEN now() END,
              CASE WHEN requested_dc IS NOT NULL THEN dci.id ELSE NULL END);
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'Enter a received quantity for at least one line'; END IF;
  PERFORM log_event('grn_created','GRN', gnum, g, NULL, NULL,
    jsonb_build_object('status','draft','lines', (SELECT jsonb_agg(jsonb_build_object('line', id, 'received', received_quantity, 'accepted', accepted_quantity, 'damaged', damaged_quantity, 'rejected', rejected_quantity, 'disposition', disposition)) FROM goods_receipt_items WHERE grn_id = g)),
    'purchase_order', _po_id);
  IF _post THEN PERFORM grn_apply(g); END IF;
  RETURN g;
END $$;
