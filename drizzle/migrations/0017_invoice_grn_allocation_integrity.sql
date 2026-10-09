-- Database-only hardening. Do NOT deploy without review of live data and
-- an approved maintenance window. SQL grammar checks do not test PL/pgSQL.
--
-- If historical duplicate invoice GRN allocations exist, fail clearly rather
-- than deleting financial records or inventing reconciliation.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.vendor_invoice_items
    GROUP BY invoice_id, grn_item_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate GRN lines in historical invoices. Reconcile before installing the unique guard.';
  END IF;
END
$preflight$;

-- Defense in depth if another path writes invoice items directly.
CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoice_items_invoice_grn_uniq
ON public.vendor_invoice_items(invoice_id, grn_item_id);

-- Supersedes 0009; keeps existing vendor-number checks, line tax/discount logic,
-- GL and audit behavior. Only adds serialized receipt availability checks.
CREATE OR REPLACE FUNCTION public.save_vendor_invoice(_id uuid, _header jsonb, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE po record; inv record; dup record; it jsonb; gi record; poi record; avail numeric; q numeric; r numeric; tr numeric; tt text; prev_total numeric;
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
  -- The same GRN item must never appear twice in one vendor bill. Without
  -- this guard each line could independently appear within the available
  -- quantity even if their combined quantity exceeded what was accepted.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_items) AS line(value)
    GROUP BY line.value->>'grn_item_id'
    HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'One GRN line cannot be invoiced twice in the same vendor bill'; END IF;

  -- Lock GRN headers before receipt lines, in a stable order. This serialises
  -- concurrent saves for the same accepted quantity and conflicts with a
  -- concurrent GRN cancellation/posting (which locks headers first).
  PERFORM g.id
    FROM goods_receipt_notes g
    WHERE g.id IN (
      SELECT DISTINCT gi.grn_id FROM goods_receipt_items gi
      WHERE gi.id IN (
        SELECT (line.value->>'grn_item_id')::uuid
        FROM jsonb_array_elements(_items) AS line(value)
      )
    )
    ORDER BY g.id FOR SHARE;
  PERFORM gi.id
    FROM goods_receipt_items gi
    WHERE gi.id IN (
      SELECT (line.value->>'grn_item_id')::uuid
      FROM jsonb_array_elements(_items) AS line(value)
    )
    ORDER BY gi.id FOR UPDATE;
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
    CASE WHEN prev IS NULL THEN NULL ELSE jsonb_build_object('status', prev, 'grand_total', prev_total) END,
    jsonb_build_object('status','draft','vendor_bill', trim(_header->>'vendor_invoice_number'), 'grand_total', gt, 'net_payable', gt - tds),
    'purchase_order', po.id);
  RETURN vid;
END $function$;
