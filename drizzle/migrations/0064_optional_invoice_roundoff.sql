-- 0064: Opt-in, server-calculated nearest-rupee invoice round-off.
-- Default is NONE. Taxable line values, GST, TDS and pre-existing invoices stay unchanged.
-- The optional signed adjustment is always explicitly visible and independently journaled.
ALTER TABLE public.vendor_invoices
  ADD COLUMN round_off_mode text NOT NULL DEFAULT 'none'
    CHECK (round_off_mode IN ('none','nearest_rupee')),
  ADD COLUMN round_off_amount numeric(18,2) NOT NULL DEFAULT 0
    CHECK (round_off_amount BETWEEN -0.50 AND 0.50);
ALTER TABLE public.vendor_invoices
  ADD CONSTRAINT vendor_invoices_round_off_consistency
  CHECK (round_off_mode <> 'none' OR round_off_amount=0);

-- Existing companies get the two P&L accounts so the invoice approval journal balances.
-- Future companies are handled lazily by invoice_transition.
INSERT INTO public.accounts(company_id,code,name,account_type,is_system)
SELECT accounts_new.company_id,accounts_new.code,accounts_new.name,accounts_new.account_type,true
FROM public.companies
CROSS JOIN LATERAL (VALUES
  (companies.id,'4300','Invoice Round-off Gain','income'),
  (companies.id,'5300','Invoice Round-off Loss','expense')
) AS accounts_new(company_id,code,name,account_type)
ON CONFLICT (company_id,code) DO NOTHING;

-- Preserve all existing function permission checks, company scoping and approval logic.
CREATE OR REPLACE FUNCTION public.save_vendor_invoice(_id uuid, _header jsonb, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE po record; inv record; dup record; it jsonb; gi record; poi record; avail numeric; q numeric; r numeric; tr numeric; tt text; prev_total numeric;
  tax numeric; ln int := 0; sub numeric := 0; taxsum numeric := 0; c numeric := 0; s numeric := 0; ig numeric := 0;
  fr numeric; oc numeric; gt numeric; tdsr numeric; tds numeric; vid uuid; prev invoice_status; vnum text; round_choice text; round_delta numeric := 0;
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
    jsonb_build_object('status','draft','vendor_bill', trim(_header->>'vendor_invoice_number'), 'grand_total', gt, 'net_payable', gt - tds),
    'purchase_order', po.id);
  RETURN vid;
END $function$;

CREATE OR REPLACE FUNCTION public.save_opening_vendor_invoice_v2(_header jsonb, _lines jsonb, _payments jsonb, _id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  pr record; v record; old record; dup record; line jsonb; payment jsonb;
  vid uuid; vnum text; row_no integer := 0; pay_no integer := 0;
  q numeric; rate numeric; discount numeric; gst_rate numeric; taxable numeric; gst numeric;
  calc_subtotal numeric := 0; calc_tax_total numeric := 0; calc_freight numeric; calc_other_charges numeric;
  gst_type text; round_choice text; round_delta numeric := 0; tdsrate numeric; tdsamt numeric; total numeric; net numeric;
  previously_paid numeric := 0; legacy_paid numeric := 0; paid numeric;
  bill_date date; v_due_date date; payment_date date; building uuid;
  description text; unit_name text; hsn text; payment_mode text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(),'vendor_invoice.create')
    THEN RAISE EXCEPTION 'No permission to create vendor invoices'; END IF;
  IF _header IS NULL OR jsonb_typeof(_header)<>'object'
    OR _lines IS NULL OR jsonb_typeof(_lines)<>'array' OR jsonb_array_length(_lines) NOT BETWEEN 1 AND 100
    OR _payments IS NULL OR jsonb_typeof(_payments)<>'array' OR jsonb_array_length(_payments)>100
    THEN RAISE EXCEPTION 'Provide the bill header, 1-100 invoice lines and up to 100 prior payments'; END IF;
  IF coalesce(_header->>'project_id','')='' OR coalesce(_header->>'vendor_id','')=''
    THEN RAISE EXCEPTION 'Choose a project and vendor'; END IF;
  SELECT * INTO pr FROM public.projects WHERE id=(_header->>'project_id')::uuid;
  IF pr.id IS NULL OR NOT public.can_access_project(auth.uid(),pr.id)
    THEN RAISE EXCEPTION 'Project not found or not accessible'; END IF;
  SELECT * INTO v FROM public.vendors WHERE id=(_header->>'vendor_id')::uuid AND company_id=pr.company_id;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vendor not found in this company'; END IF;
  IF length(btrim(coalesce(_header->>'vendor_invoice_number',''))) NOT BETWEEN 1 AND 100
    THEN RAISE EXCEPTION 'Vendor bill number must have 1-100 characters'; END IF;
  bill_date := (_header->>'vendor_invoice_date')::date;
  v_due_date := nullif(_header->>'due_date','')::date;
  IF bill_date IS NULL OR bill_date>CURRENT_DATE OR (v_due_date IS NOT NULL AND v_due_date<bill_date)
    THEN RAISE EXCEPTION 'Check the historical bill date and due date'; END IF;
  building := nullif(_header->>'building_id','')::uuid;
  IF building IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.buildings WHERE id=building AND project_id=pr.id
  ) THEN RAISE EXCEPTION 'Building does not belong to the selected project'; END IF;

  IF _id IS NOT NULL THEN
    SELECT * INTO old FROM public.vendor_invoices WHERE id=_id FOR UPDATE;
    IF old.id IS NULL OR old.company_id<>pr.company_id OR NOT old.is_opening
      OR old.status<>'pending_review' OR old.project_id<>pr.id OR old.vendor_id<>v.id
      THEN RAISE EXCEPTION 'Only an accessible, pending-review opening bill for the same vendor and project can be edited'; END IF;
    legacy_paid := old.opening_legacy_paid;
    IF EXISTS (SELECT 1 FROM public.vendor_payment_allocations WHERE invoice_id=_id)
      OR EXISTS (SELECT 1 FROM public.vendor_advance_adjustments WHERE invoice_id=_id)
      THEN RAISE EXCEPTION 'This bill has ERP payment activity and cannot be edited as historical'; END IF;
    vid := _id;
  END IF;

  SELECT id,invoice_number INTO dup FROM public.vendor_invoices
    WHERE company_id=pr.company_id AND vendor_id=v.id
      AND public.norm_bill_no(vendor_invoice_number)=public.norm_bill_no(_header->>'vendor_invoice_number')
      AND status NOT IN ('rejected','cancelled')
      AND (_id IS NULL OR id<>_id) LIMIT 1;
  IF dup.id IS NOT NULL THEN RAISE EXCEPTION 'DUPLICATE_INVOICE|%|%',dup.id,dup.invoice_number; END IF;

  gst_type := coalesce(nullif(_header->>'gst_type',''),'cgst_sgst');
  IF gst_type NOT IN ('cgst_sgst','igst','none') THEN RAISE EXCEPTION 'Select a valid GST type'; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(_lines) LOOP
    row_no := row_no+1;
    description := btrim(coalesce(line->>'description',''));
    unit_name := btrim(coalesce(line->>'unit','Nos'));
    hsn := nullif(btrim(coalesce(line->>'hsn_sac','')),'');
    IF length(description) NOT BETWEEN 1 AND 250 OR length(unit_name) NOT BETWEEN 1 AND 25
      OR (hsn IS NOT NULL AND length(hsn)>30)
      THEN RAISE EXCEPTION 'Invalid description, unit or HSN/SAC on line %',row_no; END IF;
    IF nullif(line->>'material_id','') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.items item
      JOIN public.units_of_measure u ON u.id=item.unit_id AND u.company_id=item.company_id
      WHERE item.id=(nullif(line->>'material_id',''))::uuid
        AND item.company_id=pr.company_id
        AND u.code=unit_name
    ) THEN
      RAISE EXCEPTION 'Selected material and unit do not match this company''s Materials master on line %',row_no;
    END IF;
    q := (line->>'quantity')::numeric; rate := (line->>'rate')::numeric;
    discount := coalesce(nullif(line->>'discount','')::numeric,0);
    gst_rate := coalesce(nullif(line->>'tax_rate','')::numeric,0);
    IF q IS NULL OR q<=0 OR q>1000000 OR round(q,3)<>q
      OR rate IS NULL OR rate<0 OR rate>1000000000 OR round(rate,2)<>rate
      OR discount<0 OR round(discount,2)<>discount OR gst_rate<0 OR gst_rate>100
      OR round(gst_rate,2)<>gst_rate
      THEN RAISE EXCEPTION 'Invalid quantity, rate, discount or GST on line %',row_no; END IF;
    IF gst_type='none' AND gst_rate<>0 THEN RAISE EXCEPTION 'No-GST bills cannot contain taxed lines'; END IF;
    taxable := round(q*rate-discount,2);
    IF taxable<0 OR taxable>1000000000 THEN RAISE EXCEPTION 'Discount exceeds line amount on line %',row_no; END IF;
    gst := round(taxable*gst_rate/100,2);
    calc_subtotal := calc_subtotal+taxable; calc_tax_total := calc_tax_total+gst;
    IF calc_subtotal>1000000000 OR calc_tax_total>1000000000 THEN RAISE EXCEPTION 'Invoice total is too large'; END IF;
  END LOOP;

  calc_freight := coalesce(nullif(_header->>'freight','')::numeric,0);
  calc_other_charges := coalesce(nullif(_header->>'other_charges','')::numeric,0);
  tdsrate := coalesce(nullif(_header->>'tds_rate','')::numeric,0);
  IF calc_freight<0 OR calc_other_charges<0 OR calc_freight>1000000000 OR calc_other_charges>1000000000
    OR round(calc_freight,2)<>calc_freight OR round(calc_other_charges,2)<>calc_other_charges
    OR tdsrate<0 OR tdsrate>100 OR round(tdsrate,2)<>tdsrate
    THEN RAISE EXCEPTION 'Invalid freight, other charges or TDS rate'; END IF;
  IF length(coalesce(_header->>'remarks',''))>1500 OR length(coalesce(_header->>'tds_section',''))>30
    THEN RAISE EXCEPTION 'Remarks or TDS section is too long'; END IF;
  total := round(calc_subtotal+calc_tax_total+calc_freight+calc_other_charges,2);
  round_choice := coalesce(nullif(_header->>'round_off_mode',''),'none');
  IF round_choice NOT IN ('none','nearest_rupee') THEN RAISE EXCEPTION 'Invalid round-off option'; END IF;
  round_delta := CASE WHEN round_choice='nearest_rupee' THEN round(round(total,0)-total,2) ELSE 0 END;
  IF abs(round_delta)>0.50 THEN RAISE EXCEPTION 'Round-off adjustment exceeds 50 paise'; END IF;
  total := total+round_delta;
  tdsamt := round(calc_subtotal*tdsrate/100,2);
  net := total-tdsamt;
  IF net<=0 THEN RAISE EXCEPTION 'Net payable must be positive'; END IF;

  FOR payment IN SELECT value FROM jsonb_array_elements(_payments) LOOP
    pay_no := pay_no+1;
    payment_date := (payment->>'payment_date')::date;
    payment_mode := coalesce(payment->>'payment_mode','');
    paid := (payment->>'amount')::numeric;
    IF payment_date IS NULL OR payment_date>CURRENT_DATE OR payment_mode NOT IN
      ('neft','rtgs','imps','cheque','upi','cash','card','other')
      OR paid IS NULL OR paid<=0 OR paid>1000000000 OR round(paid,2)<>paid
      THEN RAISE EXCEPTION 'Invalid historical payment entry %',pay_no; END IF;
    IF length(coalesce(payment->>'reference',''))>150 OR length(coalesce(payment->>'remarks',''))>500
      THEN RAISE EXCEPTION 'Historical payment reference/remarks are too long'; END IF;
    previously_paid := previously_paid+paid;
  END LOOP;
  IF previously_paid+legacy_paid>net THEN RAISE EXCEPTION 'Already-paid amounts exceed the invoice net payable'; END IF;

  IF vid IS NULL THEN
    vnum := public.next_fy_doc_number('VI','VI');
    INSERT INTO public.vendor_invoices (
      invoice_number,company_id,vendor_id,po_id,project_id,building_id,
      vendor_invoice_number,vendor_invoice_date,due_date,
      subtotal,tax_total,cgst,sgst,igst,freight,other_charges,grand_total,
      tds_section,tds_rate,tds_amount,net_payable,amount_paid,balance_due,
      status,match_status,remarks,attachment_path,created_by,is_opening,match_summary,round_off_mode,round_off_amount
    ) VALUES (
      vnum,pr.company_id,v.id,NULL,pr.id,building,
      btrim(_header->>'vendor_invoice_number'),bill_date,v_due_date,
      calc_subtotal,calc_tax_total,
      CASE WHEN gst_type='cgst_sgst' THEN round(calc_tax_total/2,2) ELSE 0 END,
      CASE WHEN gst_type='cgst_sgst' THEN calc_tax_total-round(calc_tax_total/2,2) ELSE 0 END,
      CASE WHEN gst_type='igst' THEN calc_tax_total ELSE 0 END,
      calc_freight,calc_other_charges,total,nullif(btrim(coalesce(_header->>'tds_section','')),''),
      tdsrate,tdsamt,net,previously_paid,net-previously_paid,
      'pending_review','pending',nullif(btrim(coalesce(_header->>'remarks','')),''),
      nullif(_header->>'attachment_path',''),auth.uid(),true,
      jsonb_build_object('opening',true,'gst_type',gst_type,'note','Historical bill — no PO or GRN; prior payments do not create cash movements'),round_choice,round_delta
    ) RETURNING id INTO vid;
  ELSE
    UPDATE public.vendor_invoices SET
      vendor_invoice_number=btrim(_header->>'vendor_invoice_number'),
      vendor_invoice_date=bill_date,due_date=v_due_date,building_id=building,
      subtotal=calc_subtotal,tax_total=calc_tax_total,
      cgst=CASE WHEN gst_type='cgst_sgst' THEN round(calc_tax_total/2,2) ELSE 0 END,
      sgst=CASE WHEN gst_type='cgst_sgst' THEN calc_tax_total-round(calc_tax_total/2,2) ELSE 0 END,
      igst=CASE WHEN gst_type='igst' THEN calc_tax_total ELSE 0 END,
      freight=calc_freight,other_charges=calc_other_charges,grand_total=total,round_off_mode=round_choice,round_off_amount=round_delta,
      tds_section=nullif(btrim(coalesce(_header->>'tds_section','')),''),
      tds_rate=tdsrate,tds_amount=tdsamt,net_payable=net,
      amount_paid=previously_paid+legacy_paid,
      balance_due=net-previously_paid-legacy_paid,
      remarks=nullif(btrim(coalesce(_header->>'remarks','')),''),
      attachment_path=coalesce(nullif(_header->>'attachment_path',''),old.attachment_path),
      match_status='pending',match_summary=jsonb_build_object('opening',true,'gst_type',gst_type,'note','Historical bill — no PO or GRN; prior payments do not create cash movements'),
      updated_at=now()
    WHERE id=vid;
    DELETE FROM public.opening_vendor_invoice_prior_payments WHERE invoice_id=vid;
    DELETE FROM public.opening_vendor_invoice_lines WHERE invoice_id=vid;
  END IF;

  row_no := 0;
  FOR line IN SELECT value FROM jsonb_array_elements(_lines) LOOP
    row_no := row_no+1;
    q := (line->>'quantity')::numeric; rate := (line->>'rate')::numeric;
    discount := coalesce(nullif(line->>'discount','')::numeric,0);
    gst_rate := coalesce(nullif(line->>'tax_rate','')::numeric,0);
    taxable := round(q*rate-discount,2);
    gst := round(taxable*gst_rate/100,2);
    INSERT INTO public.opening_vendor_invoice_lines
      (invoice_id,line_no,material_id,description,hsn_sac,unit,quantity,rate,discount,tax_rate,taxable,tax_amount,line_total)
    VALUES (vid,row_no,nullif(line->>'material_id','')::uuid,btrim(line->>'description'),nullif(btrim(coalesce(line->>'hsn_sac','')),''),
      btrim(coalesce(line->>'unit','Nos')),q,rate,discount,gst_rate,taxable,gst,taxable+gst);
  END LOOP;
  pay_no := 0;
  FOR payment IN SELECT value FROM jsonb_array_elements(_payments) LOOP
    pay_no := pay_no+1;
    INSERT INTO public.opening_vendor_invoice_prior_payments
      (invoice_id,line_no,payment_date,payment_mode,reference,amount,remarks)
    VALUES (vid,pay_no,(payment->>'payment_date')::date,payment->>'payment_mode',
      nullif(btrim(coalesce(payment->>'reference','')),''),(payment->>'amount')::numeric,
      nullif(btrim(coalesce(payment->>'remarks','')),''));
  END LOOP;
  INSERT INTO public.vendor_invoice_events(invoice_id,action,acted_by,comment,previous_status,new_status)
  VALUES (vid,CASE WHEN _id IS NULL THEN 'opening_entry' ELSE 'opening_updated' END,
    auth.uid(),'Historical invoice lines and past payments recorded; no cash/bank posting',
    CASE WHEN _id IS NULL THEN NULL ELSE 'pending_review'::invoice_status END,'pending_review');
  RETURN vid;
END $function$;

CREATE OR REPLACE FUNCTION public.invoice_transition(_id uuid, _action text, _comment text)
 RETURNS invoice_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE inv record; nxt invoice_status; m match_status;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO inv FROM public.vendor_invoices WHERE id=_id FOR UPDATE;
  IF inv.id IS NULL OR NOT public.can_access_project(auth.uid(),inv.project_id) THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF _action='submit' THEN
    IF NOT (public.has_permission(auth.uid(),'vendor_invoice.create') OR public.has_permission(auth.uid(),'vendor_invoice.review'))
      THEN RAISE EXCEPTION 'No permission'; END IF;
    IF inv.status NOT IN ('draft','exception') THEN RAISE EXCEPTION 'Only draft invoices can be submitted'; END IF;
    IF inv.is_opening THEN RAISE EXCEPTION 'Opening bills use historical verification, not PO/GRN matching'; END IF;
    m := public.run_invoice_match(_id);
    nxt := CASE WHEN m='matched' THEN 'pending_review' ELSE 'exception' END;
  ELSIF _action='approve' THEN
    IF NOT public.has_permission(auth.uid(),'vendor_invoice.approve') THEN RAISE EXCEPTION 'No permission to approve invoices'; END IF;
    IF inv.status<>'pending_review' THEN RAISE EXCEPTION 'Only invoices pending review can be approved'; END IF;
    IF inv.created_by=auth.uid() THEN RAISE EXCEPTION 'You cannot approve an invoice you entered'; END IF;
    nxt := 'approved';
  ELSIF _action='approve_exception' THEN
    IF NOT public.has_permission(auth.uid(),'vendor_invoice.approve_exception') THEN RAISE EXCEPTION 'Only a Director can approve match exceptions'; END IF;
    IF inv.status<>'exception' THEN RAISE EXCEPTION 'Invoice has no exception to approve'; END IF;
    IF inv.is_opening THEN RAISE EXCEPTION 'Opening bills cannot be approved as PO match exceptions'; END IF;
    IF inv.created_by=auth.uid() THEN RAISE EXCEPTION 'You cannot approve an invoice you entered'; END IF;
    IF coalesce(btrim(_comment),'')='' THEN RAISE EXCEPTION 'A reason is required to approve an exception'; END IF;
    nxt := 'approved';
  ELSIF _action='reject' THEN
    IF NOT (public.has_permission(auth.uid(),'vendor_invoice.approve') OR public.has_permission(auth.uid(),'vendor_invoice.approve_exception')) THEN RAISE EXCEPTION 'No permission'; END IF;
    IF inv.status NOT IN ('pending_review','exception') THEN RAISE EXCEPTION 'Invoice is not awaiting a decision'; END IF;
    IF coalesce(btrim(_comment),'')='' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
    nxt := 'rejected';
  ELSIF _action='cancel' THEN
    IF NOT public.has_permission(auth.uid(),'vendor_invoice.create') THEN RAISE EXCEPTION 'No permission'; END IF;
    IF inv.status NOT IN ('draft','exception','rejected') THEN RAISE EXCEPTION 'Approved invoices cannot be cancelled'; END IF;
    IF coalesce(btrim(_comment),'')='' THEN RAISE EXCEPTION 'A cancellation reason is required'; END IF;
    nxt := 'cancelled';
  ELSE RAISE EXCEPTION 'Invalid action'; END IF;

  UPDATE public.vendor_invoices SET status=nxt,updated_at=now(),
    balance_due=CASE WHEN nxt IN ('rejected','cancelled') THEN 0 ELSE balance_due END,
    approved_by=CASE WHEN nxt='approved' THEN auth.uid() ELSE approved_by END,
    approved_at=CASE WHEN nxt='approved' THEN now() ELSE approved_at END
    WHERE id=_id;
  IF nxt='approved' THEN
    IF inv.is_opening THEN
      -- Prior payments do not require payment approval: they are *records* of past outflows.
      -- Recognize only the outstanding opening liability, not another expense or historical GST.
      IF inv.balance_due>0 THEN
        -- Supports companies created after this migration, too.
        INSERT INTO public.accounts(company_id,code,name,account_type,is_system)
        VALUES(inv.company_id,'3000','Opening Balance Clearing — CA Reconciliation','equity',true)
        ON CONFLICT (company_id,code) DO NOTHING;
        PERFORM public.post_journal(inv.company_id,inv.vendor_invoice_date,'vendor_invoice',inv.id,
          inv.vendor_id,inv.project_id,'Opening vendor payable '||inv.invoice_number||' (CA clearing)',
          jsonb_build_array(jsonb_build_object('code','3000','debit',inv.balance_due),
                            jsonb_build_object('code','2100','credit',inv.balance_due)));
      END IF;
      IF inv.balance_due=0 THEN
        UPDATE public.vendor_invoices SET status='paid' WHERE id=_id;
        nxt:='paid';
      END IF;
    ELSE
      IF inv.round_off_amount <> 0 THEN
        INSERT INTO public.accounts(company_id,code,name,account_type,is_system)
        VALUES (inv.company_id,'4300','Invoice Round-off Gain','income',true),
               (inv.company_id,'5300','Invoice Round-off Loss','expense',true)
        ON CONFLICT (company_id,code) DO NOTHING;
      END IF;
      PERFORM public.post_journal(inv.company_id,inv.vendor_invoice_date,'vendor_invoice',inv.id,
        inv.vendor_id,inv.project_id,'Vendor invoice '||inv.invoice_number||' / bill '||inv.vendor_invoice_number,
        jsonb_build_array(
          jsonb_build_object('code','1300','debit',inv.subtotal+inv.freight+inv.other_charges),
          jsonb_build_object('code','1400','debit',inv.tax_total),
          jsonb_build_object('code','2100','credit',inv.net_payable),
          jsonb_build_object('code','2200','credit',inv.tds_amount),
          jsonb_build_object('code','5300','debit',greatest(inv.round_off_amount,0)),
          jsonb_build_object('code','4300','credit',greatest(-inv.round_off_amount,0))));
    END IF;
  END IF;
  INSERT INTO public.vendor_invoice_events(invoice_id,action,acted_by,comment,previous_status,new_status)
  VALUES (_id,_action,auth.uid(),nullif(btrim(_comment),''),inv.status,nxt);
  RETURN nxt;
END $function$;
