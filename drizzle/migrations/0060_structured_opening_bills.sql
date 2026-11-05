-- 0060: Structured opening vendor invoices and already-settled historical payments.
-- No prior payments create vendor_payments records or cash/bank journal movements.
CREATE TABLE public.opening_vendor_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.vendor_invoices(id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 100),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 250),
  hsn_sac text,
  unit text NOT NULL DEFAULT 'Nos',
  quantity numeric(15,3) NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  rate numeric(18,2) NOT NULL CHECK (rate >= 0 AND rate <= 1000000000),
  discount numeric(18,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_rate numeric(6,2) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
  taxable numeric(18,2) NOT NULL CHECK (taxable >= 0),
  tax_amount numeric(18,2) NOT NULL CHECK (tax_amount >= 0),
  line_total numeric(18,2) NOT NULL CHECK (line_total >= 0),
  UNIQUE(invoice_id,line_no)
);
CREATE INDEX opening_vendor_invoice_lines_invoice_idx ON public.opening_vendor_invoice_lines(invoice_id);

CREATE TABLE public.opening_vendor_invoice_prior_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.vendor_invoices(id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 100),
  payment_date date NOT NULL CHECK (payment_date <= CURRENT_DATE),
  payment_mode text NOT NULL CHECK (payment_mode IN ('neft','rtgs','imps','cheque','upi','cash','card','other')),
  reference text,
  amount numeric(18,2) NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
  remarks text,
  UNIQUE(invoice_id,line_no)
);
CREATE INDEX opening_vendor_invoice_prior_payments_invoice_idx ON public.opening_vendor_invoice_prior_payments(invoice_id);

ALTER TABLE public.vendor_invoices
  ADD COLUMN opening_legacy_paid numeric(18,2) NOT NULL DEFAULT 0 CHECK (opening_legacy_paid >= 0);
-- Preserve any already-entered 'amount paid outside ERP' from the original simple form.
UPDATE public.vendor_invoices SET opening_legacy_paid = amount_paid
WHERE is_opening = true AND amount_paid > 0;

ALTER TABLE public.opening_vendor_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_vendor_invoice_prior_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.opening_vendor_invoice_lines, public.opening_vendor_invoice_prior_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.opening_vendor_invoice_lines, public.opening_vendor_invoice_prior_payments TO authenticated;
CREATE POLICY opening_invoice_lines_visible ON public.opening_vendor_invoice_lines FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.vendor_invoices vi WHERE vi.id=invoice_id
  AND vi.is_opening AND public.can_access_project(auth.uid(),vi.project_id)
  AND public.has_permission(auth.uid(),'vendor_invoice.view')
));
CREATE POLICY opening_invoice_prior_payments_visible ON public.opening_vendor_invoice_prior_payments FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.vendor_invoices vi WHERE vi.id=invoice_id
  AND vi.is_opening AND public.can_access_project(auth.uid(),vi.project_id)
  AND public.has_permission(auth.uid(),'vendor_invoice.view')
));

CREATE OR REPLACE FUNCTION public.save_opening_vendor_invoice_v2(
  _header jsonb, _lines jsonb, _payments jsonb, _id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  pr record; v record; old record; dup record; line jsonb; payment jsonb;
  vid uuid; vnum text; row_no integer := 0; pay_no integer := 0;
  q numeric; rate numeric; discount numeric; gst_rate numeric; taxable numeric; gst numeric;
  subtotal numeric := 0; tax_total numeric := 0; freight numeric; other_charges numeric;
  gst_type text; tdsrate numeric; tdsamt numeric; total numeric; net numeric;
  previously_paid numeric := 0; legacy_paid numeric := 0; paid numeric;
  bill_date date; due_date date; payment_date date; building uuid;
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
  due_date := nullif(_header->>'due_date','')::date;
  IF bill_date IS NULL OR bill_date>CURRENT_DATE OR (due_date IS NOT NULL AND due_date<bill_date)
    THEN RAISE EXCEPTION 'Check the historical bill date and due date'; END IF;
  building := nullif(_header->>'building_id','')::uuid;
  IF building IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.buildings WHERE id=building AND project_id=pr.id AND company_id=pr.company_id
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
    subtotal := subtotal+taxable; tax_total := tax_total+gst;
    IF subtotal>1000000000 OR tax_total>1000000000 THEN RAISE EXCEPTION 'Invoice total is too large'; END IF;
  END LOOP;

  freight := coalesce(nullif(_header->>'freight','')::numeric,0);
  other_charges := coalesce(nullif(_header->>'other_charges','')::numeric,0);
  tdsrate := coalesce(nullif(_header->>'tds_rate','')::numeric,0);
  IF freight<0 OR other_charges<0 OR freight>1000000000 OR other_charges>1000000000
    OR round(freight,2)<>freight OR round(other_charges,2)<>other_charges
    OR tdsrate<0 OR tdsrate>100 OR round(tdsrate,2)<>tdsrate
    THEN RAISE EXCEPTION 'Invalid freight, other charges or TDS rate'; END IF;
  IF length(coalesce(_header->>'remarks',''))>1500 OR length(coalesce(_header->>'tds_section',''))>30
    THEN RAISE EXCEPTION 'Remarks or TDS section is too long'; END IF;
  total := round(subtotal+tax_total+freight+other_charges,2);
  tdsamt := round(subtotal*tdsrate/100,2);
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
      btrim(_header->>'vendor_invoice_number'),bill_date,due_date,
      subtotal,tax_total,
      CASE WHEN gst_type='cgst_sgst' THEN round(tax_total/2,2) ELSE 0 END,
      CASE WHEN gst_type='cgst_sgst' THEN tax_total-round(tax_total/2,2) ELSE 0 END,
      CASE WHEN gst_type='igst' THEN tax_total ELSE 0 END,
      freight,other_charges,total,nullif(btrim(coalesce(_header->>'tds_section','')),''),
      tdsrate,tdsamt,net,previously_paid,net-previously_paid,
      'pending_review','pending',nullif(btrim(coalesce(_header->>'remarks','')),''),
      nullif(_header->>'attachment_path',''),auth.uid(),true,
      jsonb_build_object('opening',true,'gst_type',gst_type,'note','Historical bill — no PO or GRN; prior payments do not create cash movements')
    ) RETURNING id INTO vid;
  ELSE
    UPDATE public.vendor_invoices SET
      vendor_invoice_number=btrim(_header->>'vendor_invoice_number'),
      vendor_invoice_date=bill_date,due_date=due_date,building_id=building,
      subtotal=subtotal,tax_total=tax_total,
      cgst=CASE WHEN gst_type='cgst_sgst' THEN round(tax_total/2,2) ELSE 0 END,
      sgst=CASE WHEN gst_type='cgst_sgst' THEN tax_total-round(tax_total/2,2) ELSE 0 END,
      igst=CASE WHEN gst_type='igst' THEN tax_total ELSE 0 END,
      freight=freight,other_charges=other_charges,grand_total=total,
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
      (invoice_id,line_no,description,hsn_sac,unit,quantity,rate,discount,tax_rate,taxable,tax_amount,line_total)
    VALUES (vid,row_no,btrim(line->>'description'),nullif(btrim(coalesce(line->>'hsn_sac','')),''),
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
REVOKE ALL ON FUNCTION public.save_opening_vendor_invoice_v2(jsonb,jsonb,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_opening_vendor_invoice_v2(jsonb,jsonb,jsonb,uuid) TO authenticated;

-- Preserve historical paid amounts during later scheduled/recorded ERP payments.
CREATE OR REPLACE FUNCTION public.vi_refresh_balance(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE recorded_paid numeric; historical_paid numeric; advances numeric; inv record; total_paid numeric; remaining numeric;
BEGIN
  SELECT * INTO inv FROM public.vendor_invoices WHERE id=_id FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  SELECT coalesce(sum(a.amount),0) INTO recorded_paid FROM public.vendor_payment_allocations a
    JOIN public.vendor_payments p ON p.id=a.payment_id
    WHERE a.invoice_id=_id AND p.status='recorded';
  SELECT coalesce(sum(amount),0) INTO advances FROM public.vendor_advance_adjustments WHERE invoice_id=_id;
  IF inv.is_opening THEN
    SELECT coalesce(sum(amount),0) INTO historical_paid
      FROM public.opening_vendor_invoice_prior_payments WHERE invoice_id=_id;
    historical_paid := historical_paid + inv.opening_legacy_paid;
  ELSE historical_paid:=0; END IF;
  total_paid := recorded_paid+historical_paid;
  remaining := round(inv.net_payable-total_paid-advances,2);
  IF remaining < -0.01 THEN RAISE EXCEPTION 'Invoice payments exceed net payable'; END IF;
  UPDATE public.vendor_invoices
    SET amount_paid=total_paid,advance_adjusted=advances,
      balance_due=greatest(remaining,0),
      status=CASE WHEN inv.status IN ('approved','partially_paid','paid') THEN
        (CASE WHEN remaining<=0 THEN 'paid' WHEN total_paid+advances>0 THEN 'partially_paid' ELSE 'approved' END)::invoice_status
        ELSE status END,
      updated_at=now()
    WHERE id=_id;
END $$;

-- Clear opening liabilities without double-posting historical purchases, GST or bank outflows.
-- Account 3000 is an opening-balance clearing account requiring CA reconciliation.
INSERT INTO public.accounts(company_id,code,name,account_type,is_system)
SELECT id,'3000','Opening Balance Clearing — CA Reconciliation','equity',true
FROM public.companies ON CONFLICT(company_id,code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.invoice_transition(_id uuid,_action text,_comment text)
RETURNS invoice_status LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
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
      PERFORM public.post_journal(inv.company_id,inv.vendor_invoice_date,'vendor_invoice',inv.id,
        inv.vendor_id,inv.project_id,'Vendor invoice '||inv.invoice_number||' / bill '||inv.vendor_invoice_number,
        jsonb_build_array(
          jsonb_build_object('code','1300','debit',inv.subtotal+inv.freight+inv.other_charges),
          jsonb_build_object('code','1400','debit',inv.tax_total),
          jsonb_build_object('code','2100','credit',inv.net_payable),
          jsonb_build_object('code','2200','credit',inv.tds_amount)));
    END IF;
  END IF;
  INSERT INTO public.vendor_invoice_events(invoice_id,action,acted_by,comment,previous_status,new_status)
  VALUES (_id,_action,auth.uid(),nullif(btrim(_comment),''),inv.status,nxt);
  RETURN nxt;
END $$;
