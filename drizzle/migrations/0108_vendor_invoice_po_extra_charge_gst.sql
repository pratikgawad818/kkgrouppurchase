-- 0108: Include PO-approved GST on freight/other charges in vendor bills.
-- Example: PO-2026-0004, M40 45 CUM plus pump booster Rs 20,000 + 18% GST.
-- No existing invoice, PO, GRN, or accounting records are rewritten.
-- Only future vendor invoice saves use the approved PO tax flags/rates.
-- Run in a transaction; existing finance and match approval controls retained.
CREATE OR REPLACE FUNCTION public.save_vendor_invoice(_id uuid, _header jsonb, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE po record; inv record; dup record; it jsonb; gi record; poi record; avail numeric; q numeric; r numeric; tr numeric; tt text; prev_total numeric;
  tax numeric; ln int := 0; sub numeric := 0; taxsum numeric := 0; c numeric := 0; s numeric := 0; ig numeric := 0;
  fr numeric; oc numeric; frtax numeric := 0; octax numeric := 0; gt numeric; tdsr numeric; tds numeric; vid uuid; prev invoice_status; vnum text; round_choice text; round_delta numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'vendor_invoice.create') THEN RAISE EXCEPTION 'No permission to create vendor invoices'; END IF;
  SELECT * INTO po FROM purchase_orders WHERE id = (_header->>'po_id')::uuid;
  IF po IS NULL OR NOT can_access_project(auth.uid(), po.project_id) THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF po.status NOT IN ('partially_received','partially_accepted','fully_received','short_closed','closed') THEN RAISE EXCEPTION 'Goods must be received on this PO before invoicing'; END IF;
  IF coalesce(trim(_header->>'vendor_invoice_number'),'') = '' THEN RAISE EXCEPTION 'Vendor bill number is required'; END IF;
  IF (_header->>'vendor_invoice_date') IS NULL THEN RAISE EXCEPTION 'Vendor bill date is required'; END IF;
  IF jsonb_array_length(coalesce(_items,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Add at least one invoice line'; END IF;
  -- The same GRN item must never appear twice in one vendor bill. Without
  -- this guard each line could independently appear within the available
  -- quantity even if their combined quantity exceeded what was accepted.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_items) AS line(value)
    GROUP BY line.value->>'grn_item_id'
    HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'One GRN line cannot be invoiced twice in the same vendor bill'; END IF;

  -- Lock GRN headers before receipt lines, in a stable order. Item locks
  -- serialise competing saves for the same accepted quantity; header locks
  -- conflict with concurrent GRN cancellation/posting.
  PERFORM g.id
    FROM goods_receipt_notes g
    WHERE g.id IN (
      SELECT DISTINCT locked_grn_item.grn_id FROM goods_receipt_items locked_grn_item
      WHERE locked_grn_item.id IN (
        SELECT (line.value->>'grn_item_id')::uuid
        FROM jsonb_array_elements(_items) AS line(value)
      )
    )
    ORDER BY g.id FOR SHARE;
  PERFORM locked_grn_item.id
    FROM goods_receipt_items locked_grn_item
    WHERE locked_grn_item.id IN (
      SELECT (line.value->>'grn_item_id')::uuid
      FROM jsonb_array_elements(_items) AS line(value)
    )
    ORDER BY locked_grn_item.id FOR UPDATE;
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
    vid := _id; prev := inv.status; vnum := inv.invoice_number; prev_total := inv.grand_total;
    DELETE FROM vendor_invoice_items WHERE invoice_id = vid;
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT gi2.*, g.po_id AS g_po, g.status AS g_status INTO gi FROM goods_receipt_items gi2 JOIN goods_receipt_notes g ON g.id = gi2.grn_id WHERE gi2.id = (it->>'grn_item_id')::uuid;
    IF gi IS NULL OR gi.g_po <> po.id THEN RAISE EXCEPTION 'GRN line does not belong to this purchase order'; END IF;
    IF gi.g_status <> 'posted' THEN RAISE EXCEPTION 'Only posted goods receipts can be invoiced'; END IF;
    SELECT * INTO poi FROM purchase_order_items WHERE id = gi.po_item_id;
    IF poi IS NULL OR poi.po_id <> po.id THEN RAISE EXCEPTION 'GRN line purchase order item is inconsistent'; END IF;
    q := (it->>'quantity')::numeric; r := (it->>'rate')::numeric;
    tr := coalesce((it->>'tax_rate_percent')::numeric, 0); tt := coalesce(it->>'tax_type', poi.tax_type);
    IF q IS NULL OR q <= 0 THEN RAISE EXCEPTION 'Invoice line quantity must be positive'; END IF;
    IF r IS NULL OR r < 0 THEN RAISE EXCEPTION 'Enter a valid rate'; END IF;
    avail := grn_item_available(gi.id, vid);
    -- This enforcement belongs in the SECURITY DEFINER function; frontend
    -- checks alone cannot prevent crafted RPC calls or simultaneous invoices.
    IF avail IS NULL OR avail < 0 OR q > avail THEN
      RAISE EXCEPTION 'Cannot invoice % of GRN item % — only % accepted and uninvoiced units are available',
        q, gi.id, coalesce(avail,0);
    END IF;
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
  IF fr < 0 OR oc < 0 THEN RAISE EXCEPTION 'Freight and other charges cannot be negative'; END IF;
  -- Invoice extra charges follow the approved PO GST type/rate, including
  -- construction pumping/equipment charges billed separately from concrete.
  -- A charge without GST on the PO remains untaxed; do not invent input credit.
  frtax := CASE WHEN po.freight_tax_type IN ('cgst_sgst','igst')
    THEN round(fr * coalesce(po.freight_tax_rate_percent,0)/100,2) ELSE 0 END;
  octax := CASE WHEN po.other_charges_tax_type IN ('cgst_sgst','igst')
    THEN round(oc * coalesce(po.other_charges_tax_rate_percent,0)/100,2) ELSE 0 END;
  IF po.freight_tax_type='cgst_sgst' THEN
    c := c + round(frtax/2,2); s := s + frtax-round(frtax/2,2);
  ELSIF po.freight_tax_type='igst' THEN ig := ig + frtax; END IF;
  IF po.other_charges_tax_type='cgst_sgst' THEN
    c := c + round(octax/2,2); s := s + octax-round(octax/2,2);
  ELSIF po.other_charges_tax_type='igst' THEN ig := ig + octax; END IF;
  taxsum := taxsum + frtax + octax;
  gt := sub + taxsum + fr + oc;
  round_choice := coalesce(nullif(_header->>'round_off_mode',''),'none');
  IF round_choice NOT IN ('none','nearest_rupee')
    THEN RAISE EXCEPTION 'Invalid round-off option'; END IF;
  round_delta := CASE WHEN round_choice='nearest_rupee' THEN round(round(gt,0)-gt,2) ELSE 0 END;
  IF abs(round_delta)>0.50 THEN RAISE EXCEPTION 'Round-off adjustment exceeds 50 paise'; END IF;
  gt := gt + round_delta;
  tdsr := coalesce((_header->>'tds_rate')::numeric,0);
  tds := round((sub + fr + oc) * tdsr / 100, 2);
  UPDATE vendor_invoices SET
    vendor_invoice_number = trim(_header->>'vendor_invoice_number'),
    vendor_invoice_date = (_header->>'vendor_invoice_date')::date,
    due_date = nullif(_header->>'due_date','')::date,
    subtotal = sub, tax_total = taxsum, cgst = c, sgst = s, igst = ig, freight = fr, other_charges = oc, grand_total = gt, round_off_mode = round_choice, round_off_amount = round_delta,
    tds_section = nullif(trim(coalesce(_header->>'tds_section','')),''), tds_rate = tdsr, tds_amount = tds,
    net_payable = gt - tds, balance_due = gt - tds,
    attachment_path = coalesce(nullif(_header->>'attachment_path',''), attachment_path),
    remarks = nullif(trim(coalesce(_header->>'remarks','')),''),
    status = 'draft', match_status = 'pending', match_summary = NULL, updated_at = now()
  WHERE id = vid;
  INSERT INTO vendor_invoice_events(invoice_id, action, acted_by, previous_status, new_status)
  VALUES (vid, CASE WHEN prev IS NULL THEN 'created' ELSE 'edited' END, auth.uid(), prev, 'draft');
  PERFORM log_event(CASE WHEN prev IS NULL THEN 'invoice_created' ELSE 'invoice_edited' END, 'Vendor invoice', vnum, vid, NULL,
    CASE WHEN prev IS NULL THEN NULL ELSE jsonb_build_object('status', prev, 'grand_total', prev_total) END,
    jsonb_build_object('status','draft','vendor_bill', trim(_header->>'vendor_invoice_number'),
      'grand_total', gt, 'net_payable', gt - tds,
      'freight_gst', frtax, 'other_charges_gst', octax),
    'purchase_order', po.id);
  RETURN vid;
END $function$


CREATE OR REPLACE FUNCTION public.run_invoice_match(_id uuid)
 RETURNS match_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE inv record; fs jsonb; qt numeric; rt numeric; vt numeric; l record; ok boolean; all_ok boolean := true; avail numeric;
  expected numeric := 0; qv int := 0; rv int := 0; tv int := 0; res match_status; diff numeric; ex jsonb := '[]'::jsonb; mname text; tol jsonb; summ jsonb;
  po record; frtax numeric := 0; octax numeric := 0; prior_freight numeric := 0; prior_other numeric := 0;
BEGIN
  SELECT * INTO inv FROM vendor_invoices WHERE id = _id;
  SELECT * INTO po FROM purchase_orders WHERE id=inv.po_id;
  IF po.id IS NULL OR po.company_id IS DISTINCT FROM inv.company_id THEN
    RAISE EXCEPTION 'Invoice purchase order not found in company';
  END IF;
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
  -- Match material lines against material PO lines. Charge GST belongs to the
  -- separate approved PO header, not to any received material quantity.
  frtax := CASE WHEN po.freight_tax_type IN ('cgst_sgst','igst')
    THEN round(inv.freight*coalesce(po.freight_tax_rate_percent,0)/100,2) ELSE 0 END;
  octax := CASE WHEN po.other_charges_tax_type IN ('cgst_sgst','igst')
    THEN round(inv.other_charges*coalesce(po.other_charges_tax_rate_percent,0)/100,2) ELSE 0 END;
  diff := round((inv.subtotal + inv.tax_total - frtax - octax) - expected, 2);
  IF abs(diff) > vt THEN all_ok := false;
    ex := ex || jsonb_build_object('type','value','message', format('Invoice material value differs from PO line value by ₹%s (allowed ₹%s).', diff, vt)); END IF;
  -- Preserve invoice matching when the PO charge is billed on only one of
  -- several deliveries, but flag duplicate billing or excess vs approved PO.
  SELECT coalesce(sum(other_charges),0),coalesce(sum(freight),0)
    INTO prior_other,prior_freight
    FROM vendor_invoices
    WHERE po_id=inv.po_id AND id<>inv.id
      AND status NOT IN ('cancelled','rejected');
  IF inv.other_charges+prior_other > po.other_charges+vt THEN
    all_ok := false;
    ex := ex || jsonb_build_object('type','other_charges',
      'message',format('Other charges billed ₹%s across this PO exceed approved ₹%s.',inv.other_charges+prior_other,po.other_charges));
  END IF;
  IF inv.freight+prior_freight > po.freight+vt THEN
    all_ok := false;
    ex := ex || jsonb_build_object('type','freight',
      'message',format('Freight billed ₹%s across this PO exceeds approved ₹%s.',inv.freight+prior_freight,po.freight));
  END IF;
  res := CASE WHEN all_ok THEN 'matched' ELSE 'exception' END;
  summ := jsonb_build_object('qty_variances', qv, 'rate_variances', rv, 'tax_variances', tv,
      'expected_total', round(expected,2), 'invoice_total', inv.subtotal + inv.tax_total - frtax - octax, 'total_variance', diff,
      'extra_charges_tax', frtax + octax, 'invoice_grand_total', inv.grand_total,
      'tolerances', tol, 'exceptions', ex, 'matched_at', now());
  UPDATE vendor_invoices SET match_status = res, match_summary = summ, matched_at = now(), match_tolerances = tol WHERE id = _id;
  INSERT INTO invoice_match_runs(invoice_id, run_by, qty_tolerance_pct, rate_tolerance_pct, value_tolerance, result, exceptions, summary)
  VALUES (_id, auth.uid(), qt, rt, vt, res, ex, summ);
  PERFORM log_event('invoice_matched', 'Vendor invoice', inv.invoice_number, inv.id, NULL, jsonb_build_object('match_status', inv.match_status),
    jsonb_build_object('match_status', res, 'tolerances', tol, 'exceptions', ex), 'purchase_order', inv.po_id);
  RETURN res;
END $function$

