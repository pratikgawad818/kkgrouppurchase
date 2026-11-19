-- Editable in-place procurement drafts with atomic, immutable before/after snapshots.
-- IMPORTANT: issued POs, vendor responses and downstream accounting/stock are never rewritten.
CREATE TABLE public.procurement_document_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  document_type text NOT NULL CHECK (document_type IN ('purchase_request','rfq','purchase_order')),
  document_id uuid NOT NULL,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  request_id uuid,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, document_type, document_id, revision_no),
  UNIQUE (actor_id, request_id)
);
CREATE INDEX ON public.procurement_document_revisions (company_id, document_type, document_id, created_at DESC);
ALTER TABLE public.procurement_document_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.procurement_document_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.procurement_document_revisions TO authenticated;
GRANT ALL ON public.procurement_document_revisions TO service_role;
CREATE POLICY "Read accessible document revisions" ON public.procurement_document_revisions
 FOR SELECT TO authenticated USING (
   public.actor_in_company(company_id) AND (
     (document_type='purchase_request' AND EXISTS (
       SELECT 1 FROM public.purchase_requests d
       WHERE d.id=document_id AND d.company_id=public.procurement_document_revisions.company_id
         AND public.can_access_project(auth.uid(),d.project_id)
         AND public.has_permission(auth.uid(),'purchase_request.view')
     )) OR
     (document_type='rfq' AND EXISTS (
       SELECT 1 FROM public.rfqs d
       WHERE d.id=document_id AND d.company_id=public.procurement_document_revisions.company_id AND public.rfq_can_view(d.id)
     )) OR
     (document_type='purchase_order' AND EXISTS (
       SELECT 1 FROM public.purchase_orders d
       WHERE d.id=document_id AND d.company_id=public.procurement_document_revisions.company_id AND public.po_can_view(d.id)
     ))
   )
 );

CREATE OR REPLACE FUNCTION public.save_purchase_request_revision(
  _request_id uuid, _id uuid, _header jsonb, _items jsonb,
  _submit boolean, _expected_updated_at timestamptz, _reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.purchase_requests; before_doc jsonb; after_doc jsonb;
        saved uuid; n int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not signed in'; END IF;
  IF _id IS NULL OR _request_id IS NULL THEN
    RAISE EXCEPTION 'An existing PR and save request are required'; END IF;
  IF length(btrim(coalesce(_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Enter a correction reason of 3 to 1000 characters'; END IF;
  SELECT * INTO p FROM public.purchase_requests WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR p.status <> 'draft' OR p.requested_by <> auth.uid()
    OR NOT public.actor_in_company(p.company_id)
    OR NOT public.can_access_project(auth.uid(),p.project_id)
    OR NOT public.has_permission(auth.uid(),'purchase_request.edit') THEN
      RAISE EXCEPTION 'Only the requester may edit their draft or returned PR'; END IF;
  IF EXISTS (SELECT 1 FROM public.procurement_document_revisions
      WHERE actor_id=auth.uid() AND request_id=_request_id AND document_id=_id
        AND document_type='purchase_request') THEN
    -- The original save RPC already checks payload hashes for each request token.
    RETURN public.save_purchase_request(_request_id,_id,_header,_items,_submit,_expected_updated_at);
  END IF;
  SELECT jsonb_build_object('header',to_jsonb(p),'items',
    coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_no,i.id)
      FROM public.purchase_request_items i WHERE i.purchase_request_id=_id),'[]'::jsonb))
      INTO before_doc;
  saved := public.save_purchase_request(_request_id,_id,_header,_items,_submit,_expected_updated_at);
  SELECT jsonb_build_object('header',to_jsonb(d),'items',
    coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_no,i.id)
      FROM public.purchase_request_items i WHERE i.purchase_request_id=_id),'[]'::jsonb))
      INTO after_doc FROM public.purchase_requests d WHERE d.id=_id;
  SELECT coalesce(max(revision_no),0)+1 INTO n FROM public.procurement_document_revisions
    WHERE company_id=p.company_id AND document_type='purchase_request' AND document_id=_id;
  INSERT INTO public.procurement_document_revisions
    (company_id,document_type,document_id,revision_no,actor_id,request_id,reason,before_snapshot,after_snapshot)
  VALUES(p.company_id,'purchase_request',_id,n,auth.uid(),_request_id,btrim(_reason),before_doc,after_doc);
  RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.save_purchase_request_revision(uuid,uuid,jsonb,jsonb,boolean,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_purchase_request_revision(uuid,uuid,jsonb,jsonb,boolean,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revise_rfq_draft(
  _rfq_id uuid, _expected_updated_at timestamptz,
  _header jsonb, _items jsonb, _vendor_ids uuid[], _reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.rfqs; line jsonb; orig public.purchase_request_items;
        v_id uuid; n int := 0; rev int; before_doc jsonb; after_doc jsonb;
        seen_items uuid[] := ARRAY[]::uuid[]; seen_vendors uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO r FROM public.rfqs WHERE id=_rfq_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'draft'
    OR NOT public.actor_in_company(r.company_id)
    OR NOT public.can_access_project(auth.uid(),r.project_id)
    OR NOT public.has_permission(auth.uid(),'rfq.edit') THEN
      RAISE EXCEPTION 'Only accessible draft RFQs can be revised'; END IF;
  IF _expected_updated_at IS NULL OR r.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'RFQ changed since you opened it. Reload before editing'; END IF;
  IF length(btrim(coalesce(_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'A correction reason (3–1000 characters) is required'; END IF;
  IF jsonb_typeof(_header) IS DISTINCT FROM 'object'
    OR (_header->>'response_due_date') IS NULL
    OR (_header->>'response_due_date')::date IS NULL
    OR jsonb_typeof(_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(_items) NOT BETWEEN 1 AND 500
    OR cardinality(_vendor_ids) NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'Provide due date, at least one material and one supplier'; END IF;
  IF EXISTS (SELECT 1 FROM public.vendor_quotations WHERE rfq_id=_rfq_id)
    OR EXISTS (SELECT 1 FROM public.vendor_selections WHERE rfq_id=_rfq_id)
    OR EXISTS (SELECT 1 FROM public.purchase_orders WHERE rfq_id=_rfq_id) THEN
      RAISE EXCEPTION 'RFQ has vendor responses or downstream documents and is locked'; END IF;
  FOREACH v_id IN ARRAY _vendor_ids LOOP
    IF v_id=ANY(seen_vendors) OR NOT EXISTS (
      SELECT 1 FROM public.vendors v WHERE v.id=v_id AND v.company_id=r.company_id AND v.status='active'
    ) THEN RAISE EXCEPTION 'Supplier is invalid, inactive or duplicated'; END IF;
    seen_vendors := array_append(seen_vendors,v_id);
  END LOOP;
  -- Validate all inputs before deleting old draft lines.
  FOR line IN SELECT value FROM jsonb_array_elements(_items) LOOP
    IF jsonb_typeof(line) IS DISTINCT FROM 'object'
      OR nullif(line->>'pr_item_id','') IS NULL
      OR nullif(line->>'requested_quantity','') IS NULL THEN
      RAISE EXCEPTION 'RFQ line must reference an original PR line with a quantity'; END IF;
    SELECT * INTO orig FROM public.purchase_request_items
      WHERE id=(line->>'pr_item_id')::uuid AND purchase_request_id=r.purchase_request_id;
    IF NOT FOUND OR orig.id=ANY(seen_items)
      OR (line->>'requested_quantity')::numeric <= 0
      OR (line->>'requested_quantity')::numeric::text IN ('NaN','Infinity','-Infinity') THEN
        RAISE EXCEPTION 'Invalid or duplicate RFQ material or quantity'; END IF;
    seen_items := array_append(seen_items,orig.id);
  END LOOP;
  SELECT jsonb_build_object('header',to_jsonb(r),
    'items',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_no) FROM public.rfq_items i WHERE i.rfq_id=_rfq_id),'[]'::jsonb),
    'vendors',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.vendor_id) FROM public.rfq_vendors v WHERE v.rfq_id=_rfq_id),'[]'::jsonb))
    INTO before_doc;
  DELETE FROM public.rfq_vendors WHERE rfq_id=_rfq_id;
  DELETE FROM public.rfq_items WHERE rfq_id=_rfq_id;
  FOR line IN SELECT value FROM jsonb_array_elements(_items) LOOP
    n := n+1;
    SELECT * INTO orig FROM public.purchase_request_items WHERE id=(line->>'pr_item_id')::uuid;
    INSERT INTO public.rfq_items (rfq_id,pr_item_id,line_no,material_id,description,requested_quantity,unit_id,target_rate,required_by)
      VALUES(_rfq_id,orig.id,n,orig.material_id,orig.description,(line->>'requested_quantity')::numeric,
        orig.unit_id,orig.estimated_rate,orig.required_by);
  END LOOP;
  INSERT INTO public.rfq_vendors(rfq_id,vendor_id)
    SELECT _rfq_id,unnest(_vendor_ids);
  UPDATE public.rfqs SET response_due_date=(_header->>'response_due_date')::date,
    remarks=nullif(btrim(_header->>'remarks'),'') WHERE id=_rfq_id;
  SELECT jsonb_build_object('header',to_jsonb(d),
    'items',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_no) FROM public.rfq_items i WHERE i.rfq_id=_rfq_id),'[]'::jsonb),
    'vendors',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.vendor_id) FROM public.rfq_vendors v WHERE v.rfq_id=_rfq_id),'[]'::jsonb))
    INTO after_doc FROM public.rfqs d WHERE d.id=_rfq_id;
  SELECT coalesce(max(revision_no),0)+1 INTO rev FROM public.procurement_document_revisions
    WHERE company_id=r.company_id AND document_type='rfq' AND document_id=_rfq_id;
  INSERT INTO public.procurement_document_revisions
    (company_id,document_type,document_id,revision_no,actor_id,reason,before_snapshot,after_snapshot)
  VALUES(r.company_id,'rfq',_rfq_id,rev,auth.uid(),btrim(_reason),before_doc,after_doc);
  RETURN _rfq_id;
END $$;
REVOKE ALL ON FUNCTION public.revise_rfq_draft(uuid,timestamptz,jsonb,jsonb,uuid[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revise_rfq_draft(uuid,timestamptz,jsonb,jsonb,uuid[],text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revise_po_draft(
  _po_id uuid, _expected_updated_at timestamptz,
  _header jsonb, _items jsonb, _reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.purchase_orders; line jsonb; old_line public.purchase_order_items;
        seen uuid[] := ARRAY[]::uuid[]; before_doc jsonb; after_doc jsonb;
        qty numeric; rate_num numeric; discount_num numeric; pct numeric;
        taxable numeric; tax_num numeric; tax_kind text; rev int;
        sums record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO p FROM public.purchase_orders WHERE id=_po_id FOR UPDATE;
  IF NOT FOUND OR p.status NOT IN ('draft','rejected')
    OR NOT public.actor_in_company(p.company_id)
    OR NOT public.can_access_project(auth.uid(),p.project_id)
    OR NOT public.has_permission(auth.uid(),'purchase_order.create') THEN
      RAISE EXCEPTION 'Only draft or rejected POs may be revised'; END IF;
  IF _expected_updated_at IS NULL OR p.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'PO changed since you opened it. Reload before editing'; END IF;
  IF length(btrim(coalesce(_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'A correction reason (3–1000 characters) is required'; END IF;
  IF jsonb_typeof(_header) IS DISTINCT FROM 'object'
    OR jsonb_typeof(_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(_items) = 0 OR jsonb_array_length(_items) > 500
    OR jsonb_array_length(_items) <> (SELECT count(*) FROM public.purchase_order_items WHERE po_id=_po_id) THEN
      RAISE EXCEPTION 'Submit every existing PO item exactly once'; END IF;
  IF EXISTS (SELECT 1 FROM public.goods_receipt_notes WHERE po_id=_po_id)
    OR EXISTS (SELECT 1 FROM public.vendor_delivery_challans WHERE po_id=_po_id)
    OR EXISTS (SELECT 1 FROM public.vendor_invoices WHERE po_id=_po_id) THEN
      RAISE EXCEPTION 'PO has receipt, challan or invoice history and cannot be edited'; END IF;
  IF nullif(_header->>'delivery_warehouse_id','') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.warehouses w WHERE w.id=(_header->>'delivery_warehouse_id')::uuid
      AND w.company_id=p.company_id AND w.status='active'
  ) THEN RAISE EXCEPTION 'Select an active delivery store in this company'; END IF;
  -- Lock and validate every existing line without changing its vendor/selection/material provenance.
  FOR line IN SELECT value FROM jsonb_array_elements(_items) LOOP
    IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR nullif(line->>'id','') IS NULL THEN
      RAISE EXCEPTION 'Missing PO item identifier'; END IF;
    SELECT * INTO old_line FROM public.purchase_order_items
      WHERE id=(line->>'id')::uuid AND po_id=_po_id FOR UPDATE;
    IF NOT FOUND OR old_line.id=ANY(seen) THEN RAISE EXCEPTION 'Invalid or repeated PO item'; END IF;
    seen := array_append(seen,old_line.id);
    qty := (line->>'ordered_quantity')::numeric;
    rate_num := (line->>'rate')::numeric;
    discount_num := (line->>'discount_amount')::numeric;
    pct := (line->>'tax_rate_percent')::numeric;
    tax_kind := line->>'tax_type';
    IF qty IS NULL OR rate_num IS NULL OR discount_num IS NULL OR pct IS NULL
      OR qty<=0 OR rate_num<0 OR discount_num<0 OR discount_num>round(qty*rate_num,2)
      OR pct<0 OR pct>28
      OR qty::text IN ('NaN','Infinity','-Infinity')
      OR rate_num::text IN ('NaN','Infinity','-Infinity')
      OR discount_num::text IN ('NaN','Infinity','-Infinity')
      OR pct::text IN ('NaN','Infinity','-Infinity')
      OR tax_kind NOT IN ('none','cgst_sgst','igst') THEN
      RAISE EXCEPTION 'Invalid quantity, rate, discount or GST on a PO line'; END IF;
    IF old_line.received_quantity<>0 THEN RAISE EXCEPTION 'A PO line has received quantity'; END IF;
  END LOOP;
  SELECT jsonb_build_object('header',to_jsonb(p),'items',
    coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_no) FROM public.purchase_order_items i WHERE i.po_id=_po_id),'[]'::jsonb))
    INTO before_doc;
  FOR line IN SELECT value FROM jsonb_array_elements(_items) LOOP
    qty := (line->>'ordered_quantity')::numeric;
    rate_num := (line->>'rate')::numeric;
    discount_num := (line->>'discount_amount')::numeric;
    pct := (line->>'tax_rate_percent')::numeric;
    tax_kind := line->>'tax_type';
    taxable := round(qty*rate_num-discount_num,2);
    tax_num := CASE WHEN tax_kind='none' THEN 0 ELSE round(taxable*pct/100,2) END;
    UPDATE public.purchase_order_items SET
      ordered_quantity=qty,rate=rate_num,discount_amount=discount_num,
      taxable_amount=taxable,tax_type=tax_kind,
      tax_rate_percent=CASE WHEN tax_kind='none' THEN 0 ELSE pct END,
      tax_amount=tax_num,line_total=taxable+tax_num,
      description=nullif(btrim(line->>'description'),'')
      WHERE id=(line->>'id')::uuid AND po_id=_po_id;
  END LOOP;
  SELECT sum(ordered_quantity*rate) AS subtotal,sum(discount_amount) AS discount,
    sum(tax_amount) AS tax,sum(line_total) AS total
    INTO sums FROM public.purchase_order_items WHERE po_id=_po_id;
  UPDATE public.purchase_orders SET
    delivery_warehouse_id=nullif(_header->>'delivery_warehouse_id','')::uuid,
    expected_delivery_date=nullif(_header->>'expected_delivery_date','')::date,
    payment_terms=nullif(btrim(_header->>'payment_terms'),''),
    delivery_terms=nullif(btrim(_header->>'delivery_terms'),''),
    remarks=nullif(btrim(_header->>'remarks'),''),
    subtotal=round(sums.subtotal,2),discount_total=round(sums.discount,2),
    tax_total=round(sums.tax,2)+p.freight_tax_amount+p.other_charges_tax_amount,
    grand_total=round(sums.total,2)+p.freight+p.other_charges+
       p.freight_tax_amount+p.other_charges_tax_amount,
    updated_at=now()
    WHERE id=_po_id;
  SELECT jsonb_build_object('header',to_jsonb(d),'items',
    coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_no) FROM public.purchase_order_items i WHERE i.po_id=_po_id),'[]'::jsonb))
    INTO after_doc FROM public.purchase_orders d WHERE d.id=_po_id;
  SELECT coalesce(max(revision_no),0)+1 INTO rev FROM public.procurement_document_revisions
    WHERE company_id=p.company_id AND document_type='purchase_order' AND document_id=_po_id;
  INSERT INTO public.procurement_document_revisions
    (company_id,document_type,document_id,revision_no,actor_id,reason,before_snapshot,after_snapshot)
  VALUES(p.company_id,'purchase_order',_po_id,rev,auth.uid(),btrim(_reason),before_doc,after_doc);
  RETURN _po_id;
END $$;
REVOKE ALL ON FUNCTION public.revise_po_draft(uuid,timestamptz,jsonb,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revise_po_draft(uuid,timestamptz,jsonb,jsonb,text) TO authenticated;
