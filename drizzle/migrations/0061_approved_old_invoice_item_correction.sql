-- 0061: Authorized post-approval old-bill itemization only.
-- Financial / GST totals, payments, supplier, project, dates and posted journals are immutable.
-- Existing pending-review invoices continue to use save_opening_vendor_invoice_v2.
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
      (invoice_id,line_no,description,hsn_sac,unit,quantity,rate,discount,tax_rate,taxable,tax_amount,line_total)
    VALUES (_id,line_no,btrim(entry->>'description'),
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
REVOKE ALL ON FUNCTION public.correct_approved_opening_vendor_invoice(uuid,jsonb,text,text,text,timestamptz)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.correct_approved_opening_vendor_invoice(uuid,jsonb,text,text,text,timestamptz)
  TO authenticated;