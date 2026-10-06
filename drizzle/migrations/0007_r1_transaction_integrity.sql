-- ===== Columns =====
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS accepted_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS short_closed_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS short_close_reason text;
COMMENT ON COLUMN public.purchase_order_items.received_quantity IS 'Physically received quantity (gross, includes damaged/rejected).';
COMMENT ON COLUMN public.purchase_order_items.accepted_quantity IS 'Accepted into usable stock; drives PO fulfilment.';

ALTER TABLE public.goods_receipt_items
  ADD COLUMN IF NOT EXISTS disposition public.grn_disposition NOT NULL DEFAULT 'pending_decision',
  ADD COLUMN IF NOT EXISTS disposition_reason text,
  ADD COLUMN IF NOT EXISTS disposition_by uuid,
  ADD COLUMN IF NOT EXISTS disposition_at timestamptz,
  ADD COLUMN IF NOT EXISTS short_closed_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS challan_item_id uuid;
COMMENT ON COLUMN public.goods_receipt_items.challan_item_id IS 'Reserved for Release 3 delivery challan lines.';

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS match_tolerances jsonb;

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_name text,
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS document_number text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id uuid;

-- ===== Match history (append-only) =====
CREATE TABLE IF NOT EXISTS public.invoice_match_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.vendor_invoices(id),
  run_at timestamptz NOT NULL DEFAULT now(),
  run_by uuid,
  qty_tolerance_pct numeric NOT NULL,
  rate_tolerance_pct numeric NOT NULL,
  value_tolerance numeric NOT NULL,
  result public.match_status NOT NULL,
  exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb
);
GRANT SELECT ON public.invoice_match_runs TO authenticated;
GRANT ALL ON public.invoice_match_runs TO service_role;
ALTER TABLE public.invoice_match_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View match runs with invoice" ON public.invoice_match_runs FOR SELECT TO authenticated USING (public.vi_can_view(invoice_id));

-- ===== Audit immutability =====
GRANT SELECT ON public.audit_logs TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM authenticated, anon;
CREATE OR REPLACE FUNCTION public.audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit history is permanent and cannot be changed or deleted'; END $$;
DROP TRIGGER IF EXISTS audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.audit_immutable();
CREATE TRIGGER invoice_match_runs_immutable BEFORE UPDATE OR DELETE ON public.invoice_match_runs FOR EACH ROW EXECUTE FUNCTION public.audit_immutable();

CREATE OR REPLACE FUNCTION public.log_event(_action text, _doc_type text, _doc_number text, _record_id uuid, _reason text,
  _old jsonb, _new jsonb, _source_type text DEFAULT NULL, _source_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO audit_logs(user_id, actor_name, action, entity, entity_id, document_type, document_number, reason, old_data, new_data, source_type, source_id)
  VALUES (auth.uid(), (SELECT coalesce(full_name, email) FROM profiles WHERE id = auth.uid()), _action, _doc_type, _record_id::text,
          _doc_type, _doc_number, nullif(trim(coalesce(_reason,'')),''), _old, _new, _source_type, _source_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.log_event(text,text,text,uuid,text,jsonb,jsonb,text,uuid) FROM PUBLIC, anon, authenticated;

-- ===== Permissions =====
INSERT INTO public.permissions(code, module, description, sort_order) VALUES
  ('purchase_order.short_close','purchase_orders','Short-close unresolved PO quantity', 75)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.role_permissions(role, permission_code)
SELECT r::public.app_role, 'purchase_order.short_close' FROM unnest(ARRAY['director','purchase_manager']) r
ON CONFLICT DO NOTHING;

-- ===== GRN date guard =====
CREATE OR REPLACE FUNCTION public.ist_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;
CREATE OR REPLACE FUNCTION public.grn_date_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.received_date > public.ist_today() THEN RAISE EXCEPTION 'Received date cannot be in the future'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS grn_date_guard ON public.goods_receipt_notes;
CREATE TRIGGER grn_date_guard BEFORE INSERT OR UPDATE OF received_date ON public.goods_receipt_notes FOR EACH ROW EXECUTE FUNCTION public.grn_date_guard();

-- ===== Draft GRN quantity edits audited =====
CREATE OR REPLACE FUNCTION public.grn_item_edit_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record;
BEGIN
  IF (OLD.received_quantity, OLD.damaged_quantity, OLD.rejected_quantity, OLD.accepted_quantity) IS DISTINCT FROM (NEW.received_quantity, NEW.damaged_quantity, NEW.rejected_quantity, NEW.accepted_quantity) THEN
    SELECT * INTO g FROM goods_receipt_notes WHERE id = NEW.grn_id;
    IF g.status = 'draft' THEN
      PERFORM log_event('grn_quantity_changed','GRN', g.grn_number, g.id, NULL,
        jsonb_build_object('line', OLD.id, 'received', OLD.received_quantity, 'damaged', OLD.damaged_quantity, 'rejected', OLD.rejected_quantity, 'accepted', OLD.accepted_quantity),
        jsonb_build_object('line', NEW.id, 'received', NEW.received_quantity, 'damaged', NEW.damaged_quantity, 'rejected', NEW.rejected_quantity, 'accepted', NEW.accepted_quantity),
        'purchase_order', g.po_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS grn_item_edit_audit ON public.goods_receipt_items;
CREATE TRIGGER grn_item_edit_audit AFTER UPDATE ON public.goods_receipt_items FOR EACH ROW EXECUTE FUNCTION public.grn_item_edit_audit();

-- ===== PO status from accepted quantity =====
CREATE OR REPLACE FUNCTION public.po_refresh_status(_po uuid) RETURNS po_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; incomplete int; acc numeric; rec numeric; sc numeric; nxt po_status;
BEGIN
  SELECT * INTO p FROM purchase_orders WHERE id = _po;
  IF p.status IN ('closed','cancelled','draft','pending_approval','rejected') THEN RETURN p.status; END IF;
  SELECT count(*) FILTER (WHERE accepted_quantity + short_closed_quantity < ordered_quantity),
         sum(accepted_quantity), sum(received_quantity), sum(short_closed_quantity)
    INTO incomplete, acc, rec, sc FROM purchase_order_items WHERE po_id = _po;
  nxt := CASE
    WHEN incomplete = 0 AND sc > 0 THEN 'short_closed'
    WHEN incomplete = 0 THEN 'fully_received'
    WHEN acc > 0 THEN 'partially_accepted'
    WHEN rec > 0 THEN 'partially_received'
    WHEN p.sent_at IS NOT NULL THEN 'sent' ELSE 'approved' END;
  IF nxt IS DISTINCT FROM p.status THEN UPDATE purchase_orders SET status = nxt, updated_at = now() WHERE id = _po; END IF;
  RETURN nxt;
END $$;

-- backfill accepted from posted GRNs, then refresh open POs
UPDATE public.purchase_order_items poi SET accepted_quantity = coalesce((
  SELECT sum(gi.accepted_quantity) FROM public.goods_receipt_items gi JOIN public.goods_receipt_notes g ON g.id = gi.grn_id
  WHERE gi.po_item_id = poi.id AND g.status = 'posted'),0);
SELECT public.po_refresh_status(id) FROM public.purchase_orders WHERE status IN ('partially_received','fully_received');

-- ===== GRN RPCs =====
CREATE OR REPLACE FUNCTION public.grn_apply(_grn_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; gi record; pi record; remaining numeric; st po_status;
BEGIN
  SELECT * INTO g FROM goods_receipt_notes WHERE id = _grn_id FOR UPDATE;
  IF g.received_date > ist_today() THEN RAISE EXCEPTION 'Received date cannot be in the future'; END IF;
  FOR gi IN SELECT * FROM goods_receipt_items WHERE grn_id = _grn_id LOOP
    SELECT * INTO pi FROM purchase_order_items WHERE id = gi.po_item_id FOR UPDATE;
    remaining := pi.ordered_quantity - pi.accepted_quantity - pi.short_closed_quantity;
    IF gi.received_quantity > remaining THEN
      RAISE EXCEPTION 'Cannot receive %. Only % units remain pending.', gi.received_quantity, remaining;
    END IF;
    UPDATE goods_receipt_items SET previously_received = pi.accepted_quantity WHERE id = gi.id;
    UPDATE purchase_order_items SET received_quantity = received_quantity + gi.received_quantity,
      accepted_quantity = accepted_quantity + gi.accepted_quantity WHERE id = pi.id;
    IF gi.accepted_quantity > 0 THEN
      PERFORM post_stock_x(g.company_id, 'goods_receipt', g.warehouse_id, gi.material_id, g.project_id, g.building_id, gi.accepted_quantity, 0, gi.unit_cost, g.id, gi.id, NULL, NULL, NULL);
    END IF;
  END LOOP;
  UPDATE goods_receipt_notes SET status = 'posted', posted_at = now() WHERE id = _grn_id;
  st := po_refresh_status(g.po_id);
  PERFORM log_event('grn_posted','GRN', g.grn_number, g.id, NULL, jsonb_build_object('status', g.status),
    jsonb_build_object('status','posted','po_status', st,
      'lines', (SELECT jsonb_agg(jsonb_build_object('line', id, 'received', received_quantity, 'accepted', accepted_quantity, 'damaged', damaged_quantity, 'rejected', rejected_quantity, 'disposition', disposition)) FROM goods_receipt_items WHERE grn_id = _grn_id)),
    'purchase_order', g.po_id);
END $$;

CREATE OR REPLACE FUNCTION public.create_goods_receipt(_po_id uuid, _warehouse_id uuid, _header jsonb, _items jsonb, _post boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; g uuid; gnum text; it jsonb; pi record; rq numeric; dq numeric; jq numeric; cost numeric; n int := 0; remaining numeric; disp grn_disposition; rdate date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'grn.create') THEN RAISE EXCEPTION 'No permission to record goods receipts'; END IF;
  IF _post AND NOT has_permission(auth.uid(),'grn.post') THEN RAISE EXCEPTION 'No permission to post goods receipts'; END IF;
  SELECT * INTO p FROM purchase_orders WHERE id = _po_id FOR UPDATE;
  IF p IS NULL OR NOT can_access_project(auth.uid(), p.project_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF p.status NOT IN ('approved','sent','partially_received','partially_accepted') THEN RAISE EXCEPTION 'Goods can only be received against open approved or sent POs'; END IF;
  IF NOT EXISTS (SELECT 1 FROM warehouses WHERE id = _warehouse_id AND status = 'active') THEN RAISE EXCEPTION 'Invalid store'; END IF;
  rdate := coalesce(nullif(_header->>'received_date','')::date, ist_today());
  IF rdate > ist_today() THEN RAISE EXCEPTION 'Received date cannot be in the future'; END IF;
  gnum := next_doc_number('grn','GRN');
  INSERT INTO goods_receipt_notes(grn_number, company_id, po_id, vendor_id, project_id, building_id, rfq_id, purchase_request_id, warehouse_id, received_date, challan_number, invoice_reference, vehicle_number, remarks, received_by, status)
    VALUES (gnum, p.company_id, p.id, p.vendor_id, p.project_id, p.building_id, p.rfq_id, p.purchase_request_id, _warehouse_id,
      rdate, nullif(_header->>'challan_number',''), nullif(_header->>'invoice_reference',''),
      nullif(_header->>'vehicle_number',''), nullif(_header->>'remarks',''), auth.uid(), 'draft')
    RETURNING id INTO g;
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    rq := coalesce((it->>'received_quantity')::numeric, 0); dq := coalesce((it->>'damaged_quantity')::numeric, 0); jq := coalesce((it->>'rejected_quantity')::numeric, 0);
    CONTINUE WHEN rq = 0;
    SELECT * INTO pi FROM purchase_order_items WHERE id = (it->>'po_item_id')::uuid AND po_id = _po_id;
    IF pi IS NULL THEN RAISE EXCEPTION 'Invalid PO line'; END IF;
    IF rq < 0 OR dq < 0 OR jq < 0 OR dq + jq > rq THEN RAISE EXCEPTION 'Invalid quantities on line %', pi.line_no; END IF;
    remaining := pi.ordered_quantity - pi.accepted_quantity - pi.short_closed_quantity;
    IF rq > remaining THEN RAISE EXCEPTION 'Cannot receive %. Only % units remain pending.', rq, remaining; END IF;
    disp := coalesce(nullif(it->>'disposition','')::grn_disposition, 'pending_decision');
    IF disp NOT IN ('pending_decision','replacement_expected') THEN disp := 'pending_decision'; END IF;
    IF dq + jq = 0 THEN disp := 'pending_decision'; END IF;
    cost := round(pi.taxable_amount / pi.ordered_quantity, 4);
    INSERT INTO goods_receipt_items(grn_id, po_item_id, material_id, unit_id, ordered_quantity, previously_received, received_quantity, damaged_quantity, rejected_quantity, accepted_quantity, unit_cost, remarks, disposition, disposition_by, disposition_at)
      VALUES (g, pi.id, pi.material_id, pi.unit_id, pi.ordered_quantity, pi.accepted_quantity, rq, dq, jq, rq - dq - jq, cost, nullif(it->>'remarks',''),
              disp, CASE WHEN dq + jq > 0 THEN auth.uid() END, CASE WHEN dq + jq > 0 THEN now() END);
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'Enter a received quantity for at least one line'; END IF;
  PERFORM log_event('grn_created','GRN', gnum, g, NULL, NULL,
    jsonb_build_object('status','draft','lines', (SELECT jsonb_agg(jsonb_build_object('line', id, 'received', received_quantity, 'accepted', accepted_quantity, 'damaged', damaged_quantity, 'rejected', rejected_quantity, 'disposition', disposition)) FROM goods_receipt_items WHERE grn_id = g)),
    'purchase_order', _po_id);
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
  IF NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id = g.po_id AND status IN ('approved','sent','partially_received','partially_accepted')) THEN RAISE EXCEPTION 'The PO is no longer open for receipt'; END IF;
  PERFORM grn_apply(_grn_id);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_goods_receipt(_grn_id uuid, _reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; gi record; po record; inv text; st po_status;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'grn.cancel') THEN RAISE EXCEPTION 'No permission to cancel goods receipts'; END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A cancellation reason is required'; END IF;
  SELECT * INTO g FROM goods_receipt_notes WHERE id = _grn_id FOR UPDATE;
  IF g IS NULL OR NOT can_access_project(auth.uid(), g.project_id) THEN RAISE EXCEPTION 'GRN not found'; END IF;
  IF g.status = 'cancelled' THEN RAISE EXCEPTION 'GRN is already cancelled'; END IF;
  SELECT * INTO po FROM purchase_orders WHERE id = g.po_id FOR UPDATE;
  IF po.status = 'closed' THEN RAISE EXCEPTION 'The PO is closed; GRN cannot be cancelled'; END IF;
  SELECT string_agg(DISTINCT vi.invoice_number, ', ') INTO inv FROM vendor_invoice_items vii JOIN vendor_invoices vi ON vi.id = vii.invoice_id
    WHERE vii.grn_id = _grn_id AND vi.status NOT IN ('rejected','cancelled');
  IF inv IS NOT NULL THEN RAISE EXCEPTION 'This GRN is used on vendor invoice %. Cancel or reject the invoice first.', inv; END IF;
  IF g.status = 'posted' THEN
    FOR gi IN SELECT * FROM goods_receipt_items WHERE grn_id = _grn_id LOOP
      UPDATE purchase_order_items SET received_quantity = received_quantity - gi.received_quantity,
        accepted_quantity = accepted_quantity - gi.accepted_quantity,
        short_closed_quantity = short_closed_quantity - gi.short_closed_quantity
        WHERE id = gi.po_item_id;
      IF gi.accepted_quantity > 0 THEN
        PERFORM post_stock_x(g.company_id, 'adjustment', g.warehouse_id, gi.material_id, g.project_id, g.building_id, 0, gi.accepted_quantity, gi.unit_cost, g.id, gi.id, NULL, NULL, 'Reversal of ' || g.grn_number || ': ' || trim(_reason));
      END IF;
    END LOOP;
  END IF;
  UPDATE goods_receipt_notes SET status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = trim(_reason) WHERE id = _grn_id;
  st := po_refresh_status(g.po_id);
  PERFORM log_event(CASE WHEN g.status = 'posted' THEN 'grn_reversed' ELSE 'grn_cancelled' END, 'GRN', g.grn_number, g.id, _reason,
    jsonb_build_object('status', g.status, 'po_status', po.status), jsonb_build_object('status','cancelled','po_status', st), 'purchase_order', g.po_id);
END $$;

CREATE OR REPLACE FUNCTION public.set_grn_disposition(_grn_item uuid, _disposition grn_disposition, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gi record; g record; pi record; unresolved numeric; qty numeric; st po_status;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _disposition NOT IN ('pending_decision','replacement_expected','short_close') THEN RAISE EXCEPTION 'This decision is not available yet'; END IF;
  SELECT * INTO gi FROM goods_receipt_items WHERE id = _grn_item FOR UPDATE;
  SELECT * INTO g FROM goods_receipt_notes WHERE id = gi.grn_id;
  IF g IS NULL OR NOT can_access_project(auth.uid(), g.project_id) THEN RAISE EXCEPTION 'GRN line not found'; END IF;
  IF g.status <> 'posted' THEN RAISE EXCEPTION 'Decisions can only be recorded on posted GRNs'; END IF;
  unresolved := gi.damaged_quantity + gi.rejected_quantity;
  IF unresolved <= 0 THEN RAISE EXCEPTION 'This line has no damaged or rejected quantity'; END IF;
  IF gi.disposition = 'short_close' THEN RAISE EXCEPTION 'This quantity is already short-closed'; END IF;
  IF _disposition = 'short_close' THEN
    IF NOT has_permission(auth.uid(),'purchase_order.short_close') THEN RAISE EXCEPTION 'No permission to short-close'; END IF;
    IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required to short-close'; END IF;
    SELECT * INTO pi FROM purchase_order_items WHERE id = gi.po_item_id FOR UPDATE;
    qty := least(unresolved, pi.ordered_quantity - pi.accepted_quantity - pi.short_closed_quantity);
    IF qty <= 0 THEN RAISE EXCEPTION 'Nothing remains pending on this PO line'; END IF;
    UPDATE purchase_order_items SET short_closed_quantity = short_closed_quantity + qty, short_close_reason = trim(_reason) WHERE id = pi.id;
    UPDATE goods_receipt_items SET short_closed_quantity = qty WHERE id = gi.id;
  ELSE
    IF NOT has_permission(auth.uid(),'grn.post') THEN RAISE EXCEPTION 'No permission'; END IF;
  END IF;
  UPDATE goods_receipt_items SET disposition = _disposition, disposition_reason = nullif(trim(coalesce(_reason,'')),''), disposition_by = auth.uid(), disposition_at = now() WHERE id = gi.id;
  st := po_refresh_status(g.po_id);
  PERFORM log_event(CASE WHEN _disposition = 'short_close' THEN 'short_close' ELSE 'disposition_decision' END, 'GRN', g.grn_number, g.id, _reason,
    jsonb_build_object('line', gi.id, 'disposition', gi.disposition),
    jsonb_build_object('line', gi.id, 'disposition', _disposition, 'unresolved', unresolved, 'short_closed', coalesce(qty,0), 'po_status', st),
    'purchase_order', g.po_id);
END $$;

CREATE OR REPLACE FUNCTION public.short_close_po_line(_po_item uuid, _qty numeric, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pi record; p record; remaining numeric; st po_status;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'purchase_order.short_close') THEN RAISE EXCEPTION 'No permission to short-close'; END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required to short-close'; END IF;
  SELECT * INTO pi FROM purchase_order_items WHERE id = _po_item FOR UPDATE;
  SELECT * INTO p FROM purchase_orders WHERE id = pi.po_id FOR UPDATE;
  IF p IS NULL OR NOT can_access_project(auth.uid(), p.project_id) THEN RAISE EXCEPTION 'PO line not found'; END IF;
  IF p.status NOT IN ('approved','sent','partially_received','partially_accepted') THEN RAISE EXCEPTION 'This PO is not open'; END IF;
  remaining := pi.ordered_quantity - pi.accepted_quantity - pi.short_closed_quantity;
  IF _qty IS NULL OR _qty <= 0 OR _qty > remaining THEN RAISE EXCEPTION 'You can short-close up to % units on this line', remaining; END IF;
  UPDATE purchase_order_items SET short_closed_quantity = short_closed_quantity + _qty, short_close_reason = trim(_reason) WHERE id = pi.id;
  st := po_refresh_status(p.id);
  PERFORM log_event('short_close','PO', p.po_number, p.id, _reason,
    jsonb_build_object('line', pi.id, 'short_closed', pi.short_closed_quantity, 'po_status', p.status),
    jsonb_build_object('line', pi.id, 'short_closed', pi.short_closed_quantity + _qty, 'po_status', st), 'purchase_order', p.id);
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
    IF EXISTS (SELECT 1 FROM goods_receipt_notes WHERE po_id = _po_id AND status <> 'cancelled') THEN RAISE EXCEPTION 'PO has goods receipts'; END IF;
    IF coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A cancellation reason is required'; END IF;
    nxt := 'cancelled';
  ELSIF _action = 'closed' THEN
    IF NOT has_permission(auth.uid(),'purchase_order.approve') THEN RAISE EXCEPTION 'No permission'; END IF;
    IF p.status NOT IN ('partially_received','partially_accepted','fully_received','short_closed') THEN RAISE EXCEPTION 'Only received POs can be closed'; END IF;
    IF p.status IN ('partially_received','partially_accepted') AND coalesce(trim(_comment),'') = '' THEN RAISE EXCEPTION 'A reason is required to close a PO with pending quantity'; END IF;
    nxt := 'closed';
  ELSE RAISE EXCEPTION 'Invalid action'; END IF;
  UPDATE purchase_orders SET status = nxt, updated_at = now(),
    approved_by = CASE WHEN nxt = 'approved' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN nxt = 'approved' THEN now() ELSE approved_at END,
    sent_at = CASE WHEN nxt = 'sent' THEN now() ELSE sent_at END
    WHERE id = _po_id;
  INSERT INTO purchase_order_approvals(po_id, action, acted_by, comment, previous_status, new_status) VALUES (_po_id, _action, auth.uid(), nullif(trim(_comment),''), p.status, nxt);
  PERFORM log_event('po_' || _action::text, 'PO', p.po_number, p.id, _comment, jsonb_build_object('status', p.status), jsonb_build_object('status', nxt));
  RETURN nxt;
END $$;

-- ===== Duplicate invoice protection =====
CREATE OR REPLACE FUNCTION public.norm_bill_no(_t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(regexp_replace(coalesce(_t,''), '\s', '', 'g')) $$;
CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoices_active_bill_uniq ON public.vendor_invoices (company_id, vendor_id, public.norm_bill_no(vendor_invoice_number))
  WHERE status NOT IN ('rejected','cancelled');
ALTER TABLE public.vendor_invoices DROP CONSTRAINT IF EXISTS vendor_invoices_vendor_id_vendor_invoice_number_key;

CREATE OR REPLACE FUNCTION public.save_vendor_invoice(_id uuid, _header jsonb, _items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE po record; inv record; dup record; it jsonb; gi record; poi record; avail numeric; q numeric; r numeric; tr numeric; tt text;
  tax numeric; ln int := 0; sub numeric := 0; taxsum numeric := 0; c numeric := 0; s numeric := 0; ig numeric := 0;
  fr numeric; oc numeric; gt numeric; tdsr numeric; tds numeric; vid uuid; prev invoice_status; vnum text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'vendor_invoice.create') THEN RAISE EXCEPTION 'No permission to create vendor invoices'; END IF;
  SELECT * INTO po FROM purchase_orders WHERE id = (_header->>'po_id')::uuid;
  IF po IS NULL OR NOT can_access_project(auth.uid(), po.project_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF po.status NOT IN ('partially_received','partially_accepted','fully_received','short_closed','closed') THEN RAISE EXCEPTION 'Goods must be received on this PO before invoicing'; END IF;
  IF coalesce(trim(_header->>'vendor_invoice_number'),'') = '' THEN RAISE EXCEPTION 'Vendor bill number is required'; END IF;
  IF (_header->>'vendor_invoice_date') IS NULL THEN RAISE EXCEPTION 'Vendor bill date is required'; END IF;
  IF jsonb_array_length(coalesce(_items,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Add at least one invoice line'; END IF;
  SELECT id, invoice_number, status INTO dup FROM vendor_invoices
    WHERE company_id = po.company_id AND vendor_id = po.vendor_id AND norm_bill_no(vendor_invoice_number) = norm_bill_no(_header->>'vendor_invoice_number')
      AND status NOT IN ('rejected','cancelled') AND (_id IS NULL OR id <> _id) LIMIT 1;
  IF dup.id IS NOT NULL THEN
    RAISE EXCEPTION 'DUPLICATE_INVOICE|%|%|%', dup.id, dup.invoice_number, dup.status;
  END IF;

  IF _id IS NULL THEN
    vnum := next_fy_doc_number('VI','VI');
    INSERT INTO vendor_invoices(invoice_number, company_id, vendor_id, po_id, project_id, building_id, vendor_invoice_number, vendor_invoice_date, created_by)
    VALUES (vnum, po.company_id, po.vendor_id, po.id, po.project_id, po.building_id,
            trim(_header->>'vendor_invoice_number'), (_header->>'vendor_invoice_date')::date, auth.uid())
    RETURNING id INTO vid;
    prev := NULL;
  ELSE
    SELECT * INTO inv FROM vendor_invoices WHERE id = _id FOR UPDATE;
    IF inv IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF inv.status NOT IN ('draft','exception') THEN RAISE EXCEPTION 'Only draft or exception invoices can be edited'; END IF;
    IF inv.po_id <> po.id THEN RAISE EXCEPTION 'Purchase order cannot be changed'; END IF;
    vid := _id; prev := inv.status; vnum := inv.invoice_number;
    DELETE FROM vendor_invoice_items WHERE invoice_id = vid;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT gi2.*, g.po_id AS g_po, g.status AS g_status INTO gi FROM goods_receipt_items gi2 JOIN goods_receipt_notes g ON g.id = gi2.grn_id WHERE gi2.id = (it->>'grn_item_id')::uuid;
    IF gi IS NULL OR gi.g_po <> po.id THEN RAISE EXCEPTION 'GRN line does not belong to this purchase order'; END IF;
    IF gi.g_status <> 'posted' THEN RAISE EXCEPTION 'Only posted goods receipts can be invoiced'; END IF;
    SELECT * INTO poi FROM purchase_order_items WHERE id = gi.po_item_id;
    q := (it->>'quantity')::numeric; r := (it->>'rate')::numeric;
    tr := coalesce((it->>'tax_rate_percent')::numeric, 0); tt := coalesce(it->>'tax_type', poi.tax_type);
    IF q IS NULL OR q <= 0 THEN CONTINUE; END IF;
    IF r IS NULL OR r < 0 THEN RAISE EXCEPTION 'Enter a valid rate'; END IF;
    avail := grn_item_available(gi.id, vid);
    ln := ln + 1;
    tax := round(q * r * tr / 100, 2);
    INSERT INTO vendor_invoice_items(invoice_id, line_no, grn_id, grn_item_id, po_item_id, material_id, quantity, rate, tax_type, tax_rate_percent,
      taxable_amount, tax_amount, line_total, po_rate, po_tax_rate, available_quantity)
    VALUES (vid, ln, gi.grn_id, gi.id, poi.id, gi.material_id, q, r, tt, tr, round(q*r,2), tax, round(q*r,2) + tax, poi.rate, poi.tax_rate_percent, avail);
    sub := sub + round(q*r,2); taxsum := taxsum + tax;
    IF tt = 'igst' THEN ig := ig + tax; ELSIF tt = 'cgst_sgst' THEN c := c + round(tax/2,2); s := s + tax - round(tax/2,2); END IF;
  END LOOP;
  IF ln = 0 THEN RAISE EXCEPTION 'Add at least one invoice line with a quantity'; END IF;

  fr := coalesce((_header->>'freight')::numeric,0); oc := coalesce((_header->>'other_charges')::numeric,0);
  gt := sub + taxsum + fr + oc;
  tdsr := coalesce((_header->>'tds_rate')::numeric,0);
  tds := round((sub + fr + oc) * tdsr / 100, 2);
  UPDATE vendor_invoices SET
    vendor_invoice_number = trim(_header->>'vendor_invoice_number'),
    vendor_invoice_date = (_header->>'vendor_invoice_date')::date,
    due_date = nullif(_header->>'due_date','')::date,
    subtotal = sub, tax_total = taxsum, cgst = c, sgst = s, igst = ig, freight = fr, other_charges = oc, grand_total = gt,
    tds_section = nullif(trim(coalesce(_header->>'tds_section','')),''), tds_rate = tdsr, tds_amount = tds,
    net_payable = gt - tds, balance_due = gt - tds,
    attachment_path = coalesce(nullif(_header->>'attachment_path',''), attachment_path),
    remarks = nullif(trim(coalesce(_header->>'remarks','')),''),
    status = 'draft', match_status = 'pending', match_summary = NULL, updated_at = now()
  WHERE id = vid;
  INSERT INTO vendor_invoice_events(invoice_id, action, acted_by, previous_status, new_status)
  VALUES (vid, CASE WHEN prev IS NULL THEN 'created' ELSE 'edited' END, auth.uid(), prev, 'draft');
  PERFORM log_event(CASE WHEN prev IS NULL THEN 'invoice_created' ELSE 'invoice_edited' END, 'Vendor invoice', vnum, vid, NULL,
    CASE WHEN prev IS NULL THEN NULL ELSE jsonb_build_object('status', prev, 'grand_total', inv.grand_total) END,
    jsonb_build_object('status','draft','vendor_bill', trim(_header->>'vendor_invoice_number'), 'grand_total', gt, 'net_payable', gt - tds),
    'purchase_order', po.id);
  RETURN vid;
END $$;

-- ===== Matching with tolerance snapshot =====
CREATE OR REPLACE FUNCTION public.run_invoice_match(_id uuid) RETURNS match_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; fs jsonb; qt numeric; rt numeric; vt numeric; l record; ok boolean; all_ok boolean := true; avail numeric;
  expected numeric := 0; qv int := 0; rv int := 0; tv int := 0; res match_status; diff numeric; ex jsonb := '[]'::jsonb; mname text; tol jsonb; summ jsonb;
BEGIN
  SELECT * INTO inv FROM vendor_invoices WHERE id = _id;
  SELECT finance_settings INTO fs FROM companies WHERE id = inv.company_id;
  qt := coalesce((fs->>'qty_tolerance_pct')::numeric,0); rt := coalesce((fs->>'rate_tolerance_pct')::numeric,0); vt := coalesce((fs->>'value_tolerance')::numeric,0);
  tol := jsonb_build_object('qty_pct', qt, 'rate_pct', rt, 'value', vt, 'source', 'Company Settings → Finance');
  FOR l IN SELECT vii.*, it.name AS mat FROM vendor_invoice_items vii LEFT JOIN items it ON it.id = vii.material_id WHERE invoice_id = _id ORDER BY line_no LOOP
    ok := true; mname := coalesce(l.mat, 'Line ' || l.line_no);
    avail := grn_item_available(l.grn_item_id, _id);
    IF l.quantity > avail * (1 + qt/100) THEN ok := false; qv := qv + 1;
      ex := ex || jsonb_build_object('line', l.line_no, 'type', 'quantity', 'message', format('%s: Invoice quantity exceeds accepted quantity by %s.', mname, trim(to_char(l.quantity - avail, 'FM999999999990.###')))); END IF;
    IF l.po_rate > 0 AND abs(l.rate - l.po_rate) > l.po_rate * rt / 100 THEN ok := false; rv := rv + 1;
      ex := ex || jsonb_build_object('line', l.line_no, 'type', 'rate', 'message', format('%s: Invoice rate %s differs from PO rate %s.', mname, l.rate, l.po_rate));
    ELSIF l.po_rate = 0 AND l.rate > 0 THEN ok := false; rv := rv + 1;
      ex := ex || jsonb_build_object('line', l.line_no, 'type', 'rate', 'message', format('%s: PO has no rate for this line.', mname)); END IF;
    IF l.tax_rate_percent <> l.po_tax_rate THEN ok := false; tv := tv + 1;
      ex := ex || jsonb_build_object('line', l.line_no, 'type', 'tax', 'message', format('%s: Tax rate %s%% differs from PO tax rate %s%%.', mname, l.tax_rate_percent, l.po_tax_rate)); END IF;
    UPDATE vendor_invoice_items SET available_quantity = avail, qty_variance = l.quantity - avail, rate_variance = l.rate - l.po_rate,
      tax_variance = l.tax_rate_percent - l.po_tax_rate, match_ok = ok WHERE id = l.id;
    expected := expected + round(l.quantity * l.po_rate, 2) * (1 + l.po_tax_rate/100);
    all_ok := all_ok AND ok;
  END LOOP;
  diff := round((inv.subtotal + inv.tax_total) - expected, 2);
  IF abs(diff) > vt THEN all_ok := false;
    ex := ex || jsonb_build_object('type','value','message', format('Invoice value differs from PO value by ₹%s (allowed ₹%s).', diff, vt)); END IF;
  res := CASE WHEN all_ok THEN 'matched' ELSE 'exception' END;
  summ := jsonb_build_object('qty_variances', qv, 'rate_variances', rv, 'tax_variances', tv,
      'expected_total', round(expected,2), 'invoice_total', inv.subtotal + inv.tax_total, 'total_variance', diff,
      'tolerances', tol, 'exceptions', ex, 'matched_at', now());
  UPDATE vendor_invoices SET match_status = res, match_summary = summ, matched_at = now(), match_tolerances = tol WHERE id = _id;
  INSERT INTO invoice_match_runs(invoice_id, run_by, qty_tolerance_pct, rate_tolerance_pct, value_tolerance, result, exceptions, summary)
  VALUES (_id, auth.uid(), qt, rt, vt, res, ex, summ);
  PERFORM log_event('invoice_matched', 'Vendor invoice', inv.invoice_number, inv.id, NULL, jsonb_build_object('match_status', inv.match_status),
    jsonb_build_object('match_status', res, 'tolerances', tol, 'exceptions', ex), 'purchase_order', inv.po_id);
  RETURN res;
END $$;

-- invoice transition audit wrapper: append log after existing logic via trigger on events
CREATE OR REPLACE FUNCTION public.vi_event_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record;
BEGIN
  IF NEW.action IN ('created','edited') THEN RETURN NEW; END IF;
  SELECT * INTO inv FROM vendor_invoices WHERE id = NEW.invoice_id;
  PERFORM log_event('invoice_' || NEW.action, 'Vendor invoice', inv.invoice_number, inv.id, NEW.comment,
    jsonb_build_object('status', NEW.previous_status), jsonb_build_object('status', NEW.new_status, 'net_payable', inv.net_payable), 'purchase_order', inv.po_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vi_event_audit ON public.vendor_invoice_events;
CREATE TRIGGER vi_event_audit AFTER INSERT ON public.vendor_invoice_events FOR EACH ROW EXECUTE FUNCTION public.vi_event_audit();

-- ===== Finance settings audit =====
CREATE OR REPLACE FUNCTION public.update_finance_settings(_settings jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE comp uuid; old jsonb; nw jsonb;
BEGIN
  IF NOT has_permission(auth.uid(),'company.manage') THEN RAISE EXCEPTION 'No permission to change finance settings'; END IF;
  SELECT company_id INTO comp FROM profiles WHERE id = auth.uid();
  IF coalesce((_settings->>'qty_tolerance_pct')::numeric,0) < 0 OR coalesce((_settings->>'rate_tolerance_pct')::numeric,0) < 0 OR coalesce((_settings->>'value_tolerance')::numeric,0) < 0 THEN
    RAISE EXCEPTION 'Tolerances cannot be negative'; END IF;
  SELECT finance_settings INTO old FROM companies WHERE id = comp;
  nw := jsonb_build_object(
    'qty_tolerance_pct', coalesce((_settings->>'qty_tolerance_pct')::numeric,0),
    'rate_tolerance_pct', coalesce((_settings->>'rate_tolerance_pct')::numeric,0),
    'value_tolerance', coalesce((_settings->>'value_tolerance')::numeric,0),
    'tds_sections', coalesce(_settings->'tds_sections','[]'::jsonb));
  UPDATE companies SET finance_settings = nw, updated_at = now() WHERE id = comp;
  PERFORM log_event('finance_settings_changed', 'Finance settings', 'Company finance settings', comp, NULL, old, nw);
END $$;

GRANT EXECUTE ON FUNCTION public.set_grn_disposition(uuid, public.grn_disposition, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.short_close_po_line(uuid, numeric, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.po_refresh_status(uuid) FROM PUBLIC, anon, authenticated;