-- Quotation charge GST must be explicit. Legacy quotes remain untaxed on
-- freight/other charges (0% by default), so existing totals are unchanged.
-- Any tax rate is chosen against the supplier's actual tax treatment.
ALTER TABLE public.vendor_quotations
  ADD COLUMN freight_tax_type text NOT NULL DEFAULT 'none'
    CHECK (freight_tax_type IN ('none','cgst_sgst','igst')),
  ADD COLUMN freight_tax_rate_percent numeric NOT NULL DEFAULT 0
    CHECK (freight_tax_rate_percent >= 0 AND freight_tax_rate_percent <= 28),
  ADD COLUMN freight_tax_amount numeric NOT NULL DEFAULT 0
    CHECK (freight_tax_amount >= 0),
  ADD COLUMN other_charges_tax_type text NOT NULL DEFAULT 'none'
    CHECK (other_charges_tax_type IN ('none','cgst_sgst','igst')),
  ADD COLUMN other_charges_tax_rate_percent numeric NOT NULL DEFAULT 0
    CHECK (other_charges_tax_rate_percent >= 0 AND other_charges_tax_rate_percent <= 28),
  ADD COLUMN other_charges_tax_amount numeric NOT NULL DEFAULT 0
    CHECK (other_charges_tax_amount >= 0);

-- Copy the quote-level tax attributes to POs so that the approved document
-- carries the same landed cost, including charge GST, into print and audit.
ALTER TABLE public.purchase_orders
  ADD COLUMN freight_tax_type text NOT NULL DEFAULT 'none'
    CHECK (freight_tax_type IN ('none','cgst_sgst','igst')),
  ADD COLUMN freight_tax_rate_percent numeric NOT NULL DEFAULT 0
    CHECK (freight_tax_rate_percent >= 0 AND freight_tax_rate_percent <= 28),
  ADD COLUMN freight_tax_amount numeric NOT NULL DEFAULT 0
    CHECK (freight_tax_amount >= 0),
  ADD COLUMN other_charges_tax_type text NOT NULL DEFAULT 'none'
    CHECK (other_charges_tax_type IN ('none','cgst_sgst','igst')),
  ADD COLUMN other_charges_tax_rate_percent numeric NOT NULL DEFAULT 0
    CHECK (other_charges_tax_rate_percent >= 0 AND other_charges_tax_rate_percent <= 28),
  ADD COLUMN other_charges_tax_amount numeric NOT NULL DEFAULT 0
    CHECK (other_charges_tax_amount >= 0);

-- Recompute all amounts from saved quotation items and charge-tax settings on
-- BOTH header edits and line changes. The client never owns accounting totals.
CREATE OR REPLACE FUNCTION public.vq_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  invited record;
  item_sub numeric;
  item_disc numeric;
  item_tax numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO invited FROM public.rfq_vendors WHERE id = NEW.rfq_vendor_id;
    IF invited IS NULL OR invited.rfq_id <> NEW.rfq_id THEN
      RAISE EXCEPTION 'Vendor is not invited to this RFQ';
    END IF;
    NEW.vendor_id := invited.vendor_id;
    IF NEW.status NOT IN ('draft','submitted') THEN NEW.status := 'submitted'; END IF;
  ELSE
    NEW.rfq_id := OLD.rfq_id;
    NEW.rfq_vendor_id := OLD.rfq_vendor_id;
    NEW.vendor_id := OLD.vendor_id;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('selected','rejected')
       AND coalesce(current_setting('app.rfq_source', true),'') <> 'rpc' THEN
      RAISE EXCEPTION 'Quotation selection happens only through vendor selection';
    END IF;
  END IF;

  SELECT coalesce(sum(quoted_quantity*rate),0),
         coalesce(sum(discount_amount),0),
         coalesce(sum(tax_amount),0)
    INTO item_sub,item_disc,item_tax
    FROM public.vendor_quotation_items
   WHERE quotation_id=NEW.id AND is_quoted;

  NEW.subtotal := item_sub;
  NEW.discount_total := item_disc;
  NEW.freight_tax_amount :=
    CASE WHEN NEW.freight_tax_type='none' THEN 0
    ELSE round(NEW.freight*NEW.freight_tax_rate_percent/100,2) END;
  NEW.other_charges_tax_amount :=
    CASE WHEN NEW.other_charges_tax_type='none' THEN 0
    ELSE round(NEW.other_charges*NEW.other_charges_tax_rate_percent/100,2) END;
  NEW.tax_total := item_tax + NEW.freight_tax_amount + NEW.other_charges_tax_amount;
  NEW.grand_total := item_sub-item_disc+NEW.tax_total+NEW.freight+NEW.other_charges;
  IF TG_OP='UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $function$;

-- The item trigger calls this function after each inserted/edited line; a
-- header UPDATE now calculates all totals accurately in one place.
CREATE OR REPLACE FUNCTION public.vq_recompute(_qid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  UPDATE public.vendor_quotations SET updated_at=now() WHERE id=_qid;
END $function$;

-- The existing PO workflow still validates selected quotations and approved
-- RFQ state. Only the quotation's taxed charge fields are copied and summed.
CREATE OR REPLACE FUNCTION public.create_po_from_selection(_rfq_id uuid, _quotation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  INSERT INTO purchase_orders(po_number, company_id, rfq_id, quotation_id, purchase_request_id, vendor_id, project_id, building_id, expected_delivery_date, payment_terms, freight, other_charges, freight_tax_type, freight_tax_rate_percent, freight_tax_amount, other_charges_tax_type, other_charges_tax_rate_percent, other_charges_tax_amount, created_by)
    VALUES (next_doc_number('po','PO'), r.company_id, r.id, q.id, r.purchase_request_id, q.vendor_id, r.project_id, r.building_id,
            CASE WHEN q.delivery_days IS NOT NULL THEN current_date + q.delivery_days ELSE r.required_by_date END,
            q.payment_terms, q.freight, q.other_charges, q.freight_tax_type, q.freight_tax_rate_percent, q.freight_tax_amount, q.other_charges_tax_type, q.other_charges_tax_rate_percent, q.other_charges_tax_amount, auth.uid())
    RETURNING id INTO po;
  FOR s IN SELECT vs.id vsid, vs.selected_quantity, i.*, ri.material_id, ri.unit_id, ri.description rdesc
      FROM vendor_selections vs JOIN vendor_quotation_items i ON i.id = vs.quotation_item_id JOIN rfq_items ri ON ri.id = vs.rfq_item_id
      WHERE vs.quotation_id = q.id ORDER BY ri.line_no LOOP
    n := n + 1;
    INSERT INTO purchase_order_items(po_id, line_no, rfq_item_id, quotation_item_id, vendor_selection_id, material_id, unit_id, description, ordered_quantity, rate, discount_amount, taxable_amount, tax_type, tax_rate_percent, tax_amount, line_total)
      VALUES (po, n, s.rfq_item_id, s.id, s.vsid, s.material_id, s.unit_id, s.rdesc, s.selected_quantity, s.rate, s.discount_amount, s.taxable_amount, s.tax_type, s.tax_rate_percent, s.tax_amount, s.line_total);
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'No awarded items for this vendor'; END IF;
  UPDATE purchase_orders p SET subtotal = t.sub, discount_total = t.disc, tax_total = t.tax + p.freight_tax_amount + p.other_charges_tax_amount,
    grand_total = t.tot + p.freight + p.other_charges + p.freight_tax_amount + p.other_charges_tax_amount
    FROM (SELECT sum(rate*ordered_quantity) sub, sum(discount_amount) disc, sum(tax_amount) tax, sum(line_total) tot FROM purchase_order_items WHERE po_id = po) t
    WHERE p.id = po;
  INSERT INTO purchase_order_approvals(po_id, action, acted_by, new_status) VALUES (po, 'created', auth.uid(), 'draft');
  RETURN po;
END $function$
;
