ALTER TABLE public.vendor_invoices ADD COLUMN IF NOT EXISTS is_opening boolean NOT NULL DEFAULT false;
ALTER TABLE public.vendor_invoices ALTER COLUMN po_id DROP NOT NULL;
ALTER TABLE public.vendor_invoices ADD CONSTRAINT vendor_invoices_po_or_opening CHECK (po_id IS NOT NULL OR is_opening);

CREATE OR REPLACE FUNCTION public.save_opening_vendor_invoice(_header jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pr record; v record; dup record; vid uuid; vnum text;
  sub numeric; tax numeric; fr numeric; oc numeric; gt numeric; tdsr numeric; tds numeric; paid numeric; net numeric; igst boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'vendor_invoice.create') THEN RAISE EXCEPTION 'No permission to create vendor invoices'; END IF;
  SELECT * INTO pr FROM projects WHERE id = (_header->>'project_id')::uuid;
  IF pr IS NULL OR NOT can_access_project(auth.uid(), pr.id) THEN RAISE EXCEPTION 'Project not found'; END IF;
  SELECT * INTO v FROM vendors WHERE id = (_header->>'vendor_id')::uuid AND company_id = pr.company_id;
  IF v IS NULL THEN RAISE EXCEPTION 'Vendor not found'; END IF;
  IF coalesce(trim(_header->>'vendor_invoice_number'),'') = '' THEN RAISE EXCEPTION 'Vendor bill number is required'; END IF;
  IF (_header->>'vendor_invoice_date') IS NULL THEN RAISE EXCEPTION 'Vendor bill date is required'; END IF;
  sub := round(coalesce((_header->>'subtotal')::numeric,0),2);
  tax := round(coalesce((_header->>'tax_total')::numeric,0),2);
  fr := round(coalesce((_header->>'freight')::numeric,0),2);
  oc := round(coalesce((_header->>'other_charges')::numeric,0),2);
  tdsr := coalesce((_header->>'tds_rate')::numeric,0);
  paid := round(coalesce((_header->>'amount_paid')::numeric,0),2);
  IF sub <= 0 THEN RAISE EXCEPTION 'Enter the bill amount before tax'; END IF;
  IF tax < 0 OR fr < 0 OR oc < 0 OR tdsr < 0 OR tdsr > 100 OR paid < 0 THEN RAISE EXCEPTION 'Amounts cannot be negative'; END IF;
  gt := sub + tax + fr + oc; tds := round(sub * tdsr / 100, 2); net := gt - tds;
  IF paid > net THEN RAISE EXCEPTION 'Amount already paid cannot exceed the net payable'; END IF;
  SELECT id, invoice_number, status INTO dup FROM vendor_invoices
    WHERE company_id = pr.company_id AND vendor_id = v.id AND norm_bill_no(vendor_invoice_number) = norm_bill_no(_header->>'vendor_invoice_number')
      AND status NOT IN ('rejected','cancelled') LIMIT 1;
  IF dup.id IS NOT NULL THEN RAISE EXCEPTION 'DUPLICATE_INVOICE|%|%|%', dup.id, dup.invoice_number, dup.status; END IF;
  igst := coalesce((_header->>'igst')::boolean, false);
  vnum := next_fy_doc_number('VI','VI');
  INSERT INTO vendor_invoices(invoice_number, company_id, vendor_id, po_id, project_id, building_id, vendor_invoice_number, vendor_invoice_date, due_date,
    subtotal, tax_total, cgst, sgst, igst, freight, other_charges, grand_total, tds_section, tds_rate, tds_amount, net_payable, amount_paid, balance_due,
    status, match_status, remarks, attachment_path, created_by, is_opening, match_summary)
  VALUES (vnum, pr.company_id, v.id, NULL, pr.id, nullif(_header->>'building_id','')::uuid, trim(_header->>'vendor_invoice_number'), (_header->>'vendor_invoice_date')::date,
    nullif(_header->>'due_date','')::date, sub, tax, CASE WHEN igst THEN 0 ELSE round(tax/2,2) END, CASE WHEN igst THEN 0 ELSE tax - round(tax/2,2) END, CASE WHEN igst THEN tax ELSE 0 END,
    fr, oc, gt, nullif(trim(_header->>'tds_section'),''), tdsr, tds, net, paid, net - paid,
    'pending_review', 'matched', nullif(trim(_header->>'remarks'),''), nullif(_header->>'attachment_path',''), auth.uid(), true,
    jsonb_build_object('opening', true, 'note', 'Old / opening bill entered without PO or GRN'))
  RETURNING id INTO vid;
  INSERT INTO vendor_invoice_events(invoice_id, action, acted_by, comment, previous_status, new_status)
  VALUES (vid, 'opening_entry', auth.uid(), 'Old bill entered without PO/GRN', NULL, 'pending_review');
  RETURN vid;
END $$;
REVOKE EXECUTE ON FUNCTION public.save_opening_vendor_invoice(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_opening_vendor_invoice(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_opening_invoice_submit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NEW; END $$;