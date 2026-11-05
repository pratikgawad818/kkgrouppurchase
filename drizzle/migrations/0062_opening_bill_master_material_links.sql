-- 0062: Link historical invoice lines to company-scoped Materials master.
-- Existing historical descriptions/rates remain unchanged; material_id is optional to preserve legacy/manual service rows.
ALTER TABLE public.opening_vendor_invoice_lines
  ADD COLUMN material_id uuid NULL REFERENCES public.items(id) ON DELETE RESTRICT;
CREATE INDEX opening_vendor_invoice_lines_material_idx
  ON public.opening_vendor_invoice_lines(material_id) WHERE material_id IS NOT NULL;

-- Retain existing business rules and add master link validation atomically on both edit paths.
CREATE OR REPLACE FUNCTION public.save_opening_vendor_invoice_v2(
  _header jsonb, _lines jsonb, _payments jsonb, _id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  pr record; v record; old record; dup record; line jsonb; payment jsonb;
  vid uuid; vnum text; row_no integer := 0; pay_no integer := 0;
  q numeric; rate numeric; discount numeric; gst_rate numeric; taxable numeric; gst numeric;
  calc_subtotal numeric := 0; calc_tax_total numeric := 0; calc_freight numeric; calc_other_charges numeric;
  gst_type text; tdsrate numeric; tdsamt numeric; total numeric; net numeric;
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
      status,match_status,remarks,attachment_path,created_by,is_opening,match_summary
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
      jsonb_build_object('opening',true,'gst_type',gst_type,'note','Historical bill — no PO or GRN; prior payments do not create cash movements')
    ) RETURNING id INTO vid;
  ELSE
    UPDATE public.vendor_invoices SET
      vendor_invoice_number=btrim(_header->>'vendor_invoice_number'),
      vendor_invoice_date=bill_date,due_date=v_due_date,building_id=building,
      subtotal=calc_subtotal,tax_total=calc_tax_total,
      cgst=CASE WHEN gst_type='cgst_sgst' THEN round(calc_tax_total/2,2) ELSE 0 END,
      sgst=CASE WHEN gst_type='cgst_sgst' THEN calc_tax_total-round(calc_tax_total/2,2) ELSE 0 END,
      igst=CASE WHEN gst_type='igst' THEN calc_tax_total ELSE 0 END,
      freight=calc_freight,other_charges=calc_other_charges,grand_total=total,
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
END $$;

CREATE OR REPLACE FUNCTION public.correct_approved_opening_vendor_invoice(
  _id uuid, _lines jsonb, _remarks text, _attachment_path text,
  _reason text, _expected_updated_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  inv record; entry jsonb; line_no integer := 0;
  description text; unit_name text; hsn text;
  qty numeric; unit_price numeric; discount numeric; gst_rate numeric;
  taxable numeric; gst numeric;
  check_subtotal numeric := 0; check_gst numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR
     NOT public.has_permission(auth.uid(),'vendor_invoice.create') OR
     NOT public.has_permission(auth.uid(),'vendor_invoice.approve')
  THEN RAISE EXCEPTION 'Accounts approval permission is required to correct an approved old bill'; END IF;

  SELECT * INTO inv FROM public.vendor_invoices WHERE id=_id FOR UPDATE;
  IF inv.id IS NULL OR NOT inv.is_opening OR
     inv.status NOT IN ('approved','partially_paid','paid') OR
     NOT public.can_access_project(auth.uid(),inv.project_id)
  THEN RAISE EXCEPTION 'Only accessible approved, paid or partially paid old bills may be documented'; END IF;
  IF inv.updated_at IS DISTINCT FROM _expected_updated_at
  THEN RAISE EXCEPTION 'Invoice changed since it was opened. Refresh the page and review before saving'; END IF;
  IF length(btrim(coalesce(_reason,''))) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'Enter a correction reason of 10 to 500 characters'; END IF;
  IF length(coalesce(_remarks,''))>1500
  THEN RAISE EXCEPTION 'Invoice remarks may not exceed 1500 characters'; END IF;
  IF length(coalesce(_attachment_path,''))>1200
  THEN RAISE EXCEPTION 'Attachment path is too long'; END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines)<>'array' OR jsonb_array_length(_lines) NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'Provide 1 to 100 itemized construction materials/services'; END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(_lines) LOOP
    line_no := line_no+1;
    description := btrim(coalesce(entry->>'description',''));
    unit_name := btrim(coalesce(entry->>'unit','Nos'));
    hsn := nullif(btrim(coalesce(entry->>'hsn_sac','')),'');
    IF length(description) NOT BETWEEN 1 AND 250
      OR length(unit_name) NOT BETWEEN 1 AND 25
      OR (hsn IS NOT NULL AND length(hsn)>30)
    THEN RAISE EXCEPTION 'Invalid item description, unit or HSN/SAC on line %',line_no; END IF;
    IF nullif(entry->>'material_id','') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.items item
      JOIN public.units_of_measure u ON u.id=item.unit_id AND u.company_id=item.company_id
      WHERE item.id=(nullif(entry->>'material_id',''))::uuid
        AND item.company_id=inv.company_id
        AND u.code=unit_name
    ) THEN
      RAISE EXCEPTION 'Selected material and unit do not match this company''s Materials master on line %',line_no;
    END IF;
    qty := (entry->>'quantity')::numeric;
    unit_price := (entry->>'rate')::numeric;
    discount := coalesce(nullif(entry->>'discount','')::numeric,0);
    gst_rate := coalesce(nullif(entry->>'tax_rate','')::numeric,0);
    IF qty IS NULL OR qty<=0 OR qty>1000000 OR round(qty,3)<>qty OR
       unit_price IS NULL OR unit_price<0 OR unit_price>1000000000 OR round(unit_price,2)<>unit_price OR
       discount<0 OR round(discount,2)<>discount OR
       gst_rate<0 OR gst_rate>100 OR round(gst_rate,2)<>gst_rate
    THEN RAISE EXCEPTION 'Invalid quantity, unit price, discount or GST rate on line %',line_no; END IF;
    taxable := round(qty*unit_price-discount,2);
    IF taxable<0 OR taxable>1000000000
    THEN RAISE EXCEPTION 'Line discount exceeds taxable value on line %',line_no; END IF;
    gst := round(taxable*gst_rate/100,2);
    check_subtotal := check_subtotal+taxable;
    check_gst := check_gst+gst;
  END LOOP;

  -- This is documentation of a posted historical bill, NOT a financial amendment.
  -- Exact comparison avoids altering GST or an already-posted opening balance.
  IF round(check_subtotal,2)<>round(inv.subtotal,2) OR
     round(check_gst,2)<>round(inv.tax_total,2)
  THEN RAISE EXCEPTION
    'Itemized taxable total and GST must exactly match this approved bill (taxable %, GST %). Use a reviewed financial correction for changed amounts',
    inv.subtotal,inv.tax_total;
  END IF;
  IF inv.igst>0 AND inv.cgst+inv.sgst>0 THEN
    RAISE EXCEPTION 'This approved bill has inconsistent original GST splits; Accounts must review it'; END IF;

  DELETE FROM public.opening_vendor_invoice_lines WHERE invoice_id=_id;
  line_no := 0;
  FOR entry IN SELECT value FROM jsonb_array_elements(_lines) LOOP
    line_no := line_no+1;
    qty := (entry->>'quantity')::numeric;
    unit_price := (entry->>'rate')::numeric;
    discount := coalesce(nullif(entry->>'discount','')::numeric,0);
    gst_rate := coalesce(nullif(entry->>'tax_rate','')::numeric,0);
    taxable := round(qty*unit_price-discount,2);
    gst := round(taxable*gst_rate/100,2);
    INSERT INTO public.opening_vendor_invoice_lines
      (invoice_id,line_no,material_id,description,hsn_sac,unit,quantity,rate,discount,tax_rate,taxable,tax_amount,line_total)
    VALUES (_id,line_no,nullif(entry->>'material_id','')::uuid,btrim(entry->>'description'),
      nullif(btrim(coalesce(entry->>'hsn_sac','')),''),
      btrim(coalesce(entry->>'unit','Nos')),qty,unit_price,discount,gst_rate,taxable,gst,taxable+gst);
  END LOOP;
  UPDATE public.vendor_invoices
    SET remarks=nullif(btrim(coalesce(_remarks,'')),''),
        attachment_path=coalesce(nullif(btrim(coalesce(_attachment_path,'')),''),attachment_path),
        updated_at=clock_timestamp()
    WHERE id=_id;
  INSERT INTO public.vendor_invoice_events(invoice_id,action,acted_by,comment,previous_status,new_status)
  VALUES(_id,'opening_details_corrected',auth.uid(),btrim(_reason),inv.status,inv.status);
  RETURN _id;
END $$;
