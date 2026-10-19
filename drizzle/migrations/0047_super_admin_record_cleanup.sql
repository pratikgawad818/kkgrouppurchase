-- Remove only unused records. Posted movements, approvals and source links stay intact.
CREATE OR REPLACE FUNCTION public.super_admin_delete_record(_kind text, _id uuid, _check_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
 actor public.profiles%ROWTYPE; target jsonb; target_company uuid; tab text; label text;
 owned jsonb := '{}'::jsonb; children jsonb := '{}'::jsonb; child record; child_row jsonb;
 ref record; linked boolean; checked_table text; checked_row jsonb; stage integer;
BEGIN
 SELECT * INTO actor FROM public.profiles WHERE id=auth.uid() FOR SHARE;
 IF actor.id IS NULL OR NOT actor.is_active OR NOT public.has_role(auth.uid(),'super_admin') THEN
  RAISE EXCEPTION 'Only an active Super Admin can permanently delete records.';
 END IF;
 tab := CASE _kind
  WHEN 'material' THEN 'items' WHEN 'vendor' THEN 'vendors' WHEN 'project' THEN 'projects'
  WHEN 'building' THEN 'buildings' WHEN 'floor' THEN 'floors' WHEN 'unit' THEN 'units'
  WHEN 'warehouse' THEN 'warehouses' WHEN 'purchase_request' THEN 'purchase_requests'
  WHEN 'rfq' THEN 'rfqs' WHEN 'purchase_order' THEN 'purchase_orders' WHEN 'vendor_invoice' THEN 'vendor_invoices'
  WHEN 'goods_receipt' THEN 'goods_receipt_notes' WHEN 'user' THEN 'profiles'
  ELSE NULL END;
 IF tab IS NULL THEN RAISE EXCEPTION 'Unsupported deletion type.'; END IF;
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',tab) INTO target USING _id;
 IF target IS NULL THEN RAISE EXCEPTION 'Record not found or already deleted.'; END IF;
 target_company := (target->>'company_id')::uuid;
 IF _kind IN ('building','unit') THEN
  SELECT company_id INTO target_company FROM public.projects WHERE id=(target->>'project_id')::uuid FOR SHARE;
 ELSIF _kind='floor' THEN
  SELECT p.company_id INTO target_company FROM public.buildings b JOIN public.projects p ON p.id=b.project_id
  WHERE b.id=(target->>'building_id')::uuid FOR SHARE OF b,p;
 END IF;
 IF actor.company_id IS NULL OR target_company IS DISTINCT FROM actor.company_id THEN
  RAISE EXCEPTION 'You can delete records only in your own company.';
 END IF;
 IF _kind IN ('purchase_request','rfq','purchase_order','vendor_invoice','goods_receipt') AND target->>'status' <> 'draft' THEN
  RAISE EXCEPTION 'Only unused drafts can be permanently deleted. Open the document to cancel or correct it with history retained.';
 END IF;
 IF _kind='unit' AND target->>'status' <> 'available' THEN
  RAISE EXCEPTION 'Only an unused available property unit can be permanently deleted.';
 END IF;
 IF _kind='user' AND (_id=auth.uid() OR public.has_role(_id,'super_admin')) THEN
  RAISE EXCEPTION 'Your own account and Super Admin accounts cannot be deleted.';
 END IF;
 -- Creation/edit metadata for an unsubmitted draft is preserved in the immutable deletion snapshot.
 -- Actual submissions, approvals, returns and property status changes are never deleted.
 IF _kind='purchase_request' AND EXISTS(SELECT 1 FROM public.purchase_request_approvals WHERE purchase_request_id=_id AND action<>'created') THEN
  RAISE EXCEPTION 'This request has submission or decision history. Cancel/correct it instead.';
 END IF;
 IF _kind='purchase_order' AND EXISTS(SELECT 1 FROM public.purchase_order_approvals WHERE po_id=_id AND action<>'created') THEN
  RAISE EXCEPTION 'This order has submission or decision history. Cancel/correct it instead.';
 END IF;
 IF _kind='vendor_invoice' AND (EXISTS(SELECT 1 FROM public.vendor_invoice_events WHERE invoice_id=_id AND action NOT IN ('created','edited'))
    OR EXISTS(SELECT 1 FROM public.journal_entries WHERE source_id=_id)) THEN
  RAISE EXCEPTION 'This invoice has matching, approval or accounting history. Cancel/correct it instead.';
 END IF;
 IF _kind='unit' AND EXISTS(SELECT 1 FROM public.unit_status_history WHERE unit_id=_id AND
    (from_status IS NOT NULL OR to_status<>'available' OR reason IS DISTINCT FROM 'Unit created')) THEN
  RAISE EXCEPTION 'This property unit has status history. Edit/correct it instead.';
 END IF;
 owned := CASE _kind
  WHEN 'purchase_request' THEN '{"purchase_request_items":"purchase_request_id","purchase_request_approvals":"purchase_request_id"}'::jsonb
  WHEN 'rfq' THEN '{"rfq_items":"rfq_id","rfq_vendors":"rfq_id"}'::jsonb
  WHEN 'purchase_order' THEN '{"purchase_order_items":"po_id","purchase_order_approvals":"po_id"}'::jsonb
  WHEN 'vendor_invoice' THEN '{"vendor_invoice_items":"invoice_id","vendor_invoice_events":"invoice_id"}'::jsonb
  WHEN 'unit' THEN '{"unit_status_history":"unit_id"}'::jsonb
  WHEN 'goods_receipt' THEN '{"goods_receipt_items":"grn_id"}'::jsonb
  WHEN 'user' THEN '{"user_roles":"user_id","user_project_assignments":"user_id"}'::jsonb
  ELSE '{}'::jsonb END;
 IF _kind='rfq' AND EXISTS(SELECT 1 FROM public.rfq_vendors WHERE rfq_id=_id AND status<>'pending') THEN
  RAISE EXCEPTION 'RFQs with vendor responses cannot be permanently deleted.';
 END IF;
 -- Lock and save each owned draft line before checking dependencies. Never cascade linked history.
 FOR child IN SELECT key AS tab,value AS col FROM jsonb_each_text(owned) LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM (SELECT * FROM public.%I WHERE %I=$1 FOR UPDATE) t',child.tab,child.col)
  INTO child_row USING _id;
  children := children || jsonb_build_object(child.tab,child_row);
 END LOOP;
 -- Check all incoming FK columns, including composite keys, on the document and its draft lines.
 FOR stage IN 0..1 LOOP
  IF stage=0 THEN
   checked_table:=tab; checked_row:=target;
   FOR ref IN
    SELECT n.nspname,c.relname,f.conname,
     string_agg(format('r.%I IS NOT DISTINCT FROM ($1->>%L)::%s',a.attname,pa.attname,format_type(a.atttypid,a.atttypmod)),' AND ' ORDER BY k.ord) AS predicate,
     count(*) AS key_count,min(a.attname::text) AS child_column
    FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL unnest(f.conkey,f.confkey) WITH ORDINALITY k(child_att,parent_att,ord)
    JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=k.child_att
    JOIN pg_attribute pa ON pa.attrelid=f.confrelid AND pa.attnum=k.parent_att
    WHERE f.contype='f' AND f.confrelid=to_regclass('public.'||checked_table)
    GROUP BY n.nspname,c.relname,f.conname
   LOOP
    IF ref.nspname='public' AND ref.key_count=1 AND owned->>ref.relname=ref.child_column THEN CONTINUE; END IF;
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I r WHERE %s)',ref.nspname,ref.relname,ref.predicate) INTO linked USING checked_row;
    IF linked THEN RAISE EXCEPTION 'Linked % records exist. Cancel/correct the source document, or remove unused dependent records first. History cannot be permanently deleted.',replace(ref.relname,'_',' '); END IF;
   END LOOP;
  ELSE
   FOR child IN SELECT key AS tab,value AS rows FROM jsonb_each(children) LOOP
    FOR checked_row IN SELECT value FROM jsonb_array_elements(child.rows) LOOP
     FOR ref IN
      SELECT n.nspname,c.relname,f.conname,
       string_agg(format('r.%I IS NOT DISTINCT FROM ($1->>%L)::%s',a.attname,pa.attname,format_type(a.atttypid,a.atttypmod)),' AND ' ORDER BY k.ord) AS predicate
      FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL unnest(f.conkey,f.confkey) WITH ORDINALITY k(child_att,parent_att,ord)
      JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=k.child_att
      JOIN pg_attribute pa ON pa.attrelid=f.confrelid AND pa.attnum=k.parent_att
      WHERE f.contype='f' AND f.confrelid=to_regclass('public.'||child.tab)
      GROUP BY n.nspname,c.relname,f.conname
     LOOP
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I r WHERE %s)',ref.nspname,ref.relname,ref.predicate) INTO linked USING checked_row;
      IF linked THEN RAISE EXCEPTION 'Draft lines are linked to % records. Cancel/correct the document instead. History cannot be permanently deleted.',replace(ref.relname,'_',' '); END IF;
     END LOOP;
    END LOOP;
   END LOOP;
  END IF;
 END LOOP;
 IF _check_only THEN RETURN; END IF;
 label := coalesce(target->>'pr_number',target->>'rfq_number',target->>'po_number',target->>'invoice_number',target->>'grn_number',target->>'company_name',target->>'unit_number',target->>'name',target->>'full_name',target->>'email',_id::text);
 PERFORM public.log_event('permanently_deleted',tab,label,_id,'Super Admin confirmed permanent deletion',target||jsonb_build_object('deleted_draft_lines',children),NULL);
 FOR child IN SELECT key AS tab,value AS col FROM jsonb_each_text(owned) LOOP
  EXECUTE format('DELETE FROM public.%I WHERE %I=$1',child.tab,child.col) USING _id;
 END LOOP;
 EXECUTE format('DELETE FROM public.%I WHERE id=$1',tab) USING _id;
END $$;
REVOKE ALL ON FUNCTION public.super_admin_delete_record(text,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.super_admin_delete_record(text,uuid,boolean) TO authenticated;
COMMENT ON FUNCTION public.super_admin_delete_record(text,uuid,boolean) IS 'Active company Super Admin only; unused masters and unsubmitted draft PR/RFQ/PO/invoice/GRN; business history and FK dependencies protected; creation metadata and complete deletion snapshot retained in immutable audit. Staff auth deletion uses authenticated server function.';

-- Keep retry receipts as tombstones; retries must not return or recreate a deleted draft.
CREATE OR REPLACE FUNCTION public.save_purchase_request(
  _request_id uuid, _id uuid, _header jsonb, _items jsonb,
  _submit boolean DEFAULT false, _expected_updated_at timestamptz DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor uuid := auth.uid(); h public.purchase_requests; old_pr public.purchase_requests;
  project_company uuid; result_id uuid; receipt public.procurement_save_receipts;
  fingerprint text; line jsonb; ordinal integer := 0;
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor) THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _request_id IS NULL OR jsonb_typeof(_header) IS DISTINCT FROM 'object'
    OR jsonb_typeof(_items) IS DISTINCT FROM 'array' OR jsonb_array_length(_items)>500
    OR _submit IS NULL THEN RAISE EXCEPTION 'Invalid request payload'; END IF;
  h := jsonb_populate_record(NULL::public.purchase_requests, _header);
  SELECT p.company_id INTO project_company FROM public.projects p
    WHERE p.id=h.project_id AND p.record_status='active' AND public.can_access_project(actor,p.id);
  IF project_company IS NULL OR NOT public.actor_in_company(project_company) THEN
    RAISE EXCEPTION 'Project is not accessible'; END IF;
  IF h.required_by IS NULL THEN RAISE EXCEPTION 'Required-by date is required'; END IF;
  fingerprint := encode(sha256(convert_to(jsonb_build_object('id',_id,'header',_header,
    'items',_items,'submit',_submit,'version',_expected_updated_at)::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||_request_id::text,0));
  SELECT * INTO receipt FROM public.procurement_save_receipts WHERE actor_id=actor AND request_id=_request_id;
  IF FOUND THEN
    IF receipt.operation<>'purchase_request' OR receipt.payload_hash<>fingerprint THEN
      RAISE EXCEPTION 'This save token was already used for different content'; END IF;
    PERFORM 1 FROM public.purchase_requests WHERE id=receipt.document_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'This draft was deleted by a Super Admin. Start a new request instead of retrying the deleted draft'; END IF;
    RETURN /* checked document */ receipt.document_id;
  END IF;
  IF _id IS NULL THEN
    IF NOT public.has_permission(actor,'purchase_request.create') THEN RAISE EXCEPTION 'No permission to create requests'; END IF;
    INSERT INTO public.purchase_requests(pr_number,company_id,project_id,building_id,floor_id,requested_by,
      required_by,priority,request_type,purpose,remarks)
    VALUES ('auto',project_company,h.project_id,h.building_id,h.floor_id,actor,h.required_by,
      coalesce(h.priority,'normal'),coalesce(h.request_type,'material'),nullif(btrim(h.purpose),''),nullif(btrim(h.remarks),''))
    RETURNING id INTO result_id;
  ELSE
    SELECT * INTO old_pr FROM public.purchase_requests WHERE id=_id FOR UPDATE;
    IF NOT FOUND OR old_pr.requested_by<>actor OR old_pr.company_id<>project_company
      OR NOT public.can_access_project(actor,old_pr.project_id)
      OR NOT public.has_permission(actor,'purchase_request.edit') THEN RAISE EXCEPTION 'Request is not editable'; END IF;
    IF old_pr.status<>'draft' THEN RAISE EXCEPTION 'Only draft requests can be edited'; END IF;
    IF _expected_updated_at IS NULL OR old_pr.updated_at IS DISTINCT FROM _expected_updated_at THEN
      RAISE EXCEPTION 'This request changed since you opened it. Reload before saving'; END IF;
    UPDATE public.purchase_requests SET project_id=h.project_id,building_id=h.building_id,floor_id=h.floor_id,
      required_by=h.required_by,priority=coalesce(h.priority,'normal'),request_type=coalesce(h.request_type,'material'),
      purpose=nullif(btrim(h.purpose),''),remarks=nullif(btrim(h.remarks),'') WHERE id=_id;
    result_id := _id;
    DELETE FROM public.purchase_request_items WHERE purchase_request_id=result_id;
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(_items) LOOP
    ordinal := ordinal+1;
    IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR NOT EXISTS (
      SELECT 1 FROM public.items m JOIN public.units_of_measure u ON u.id=(line->>'unit_id')::uuid
      WHERE m.id=(line->>'material_id')::uuid AND m.company_id=project_company AND m.status='active' AND u.company_id=project_company AND u.status='active'
    ) THEN RAISE EXCEPTION 'Choose an active material and unit in this company'; END IF;
    IF (line->>'quantity')::numeric IS NULL OR (line->>'quantity')::numeric<=0
      OR (line->>'quantity')::numeric::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Each line needs a positive finite quantity'; END IF;
    INSERT INTO public.purchase_request_items(purchase_request_id,line_no,material_id,description,quantity,unit_id,
      estimated_rate,required_by,notes)
    VALUES(result_id,ordinal,(line->>'material_id')::uuid,nullif(line->>'description',''),(line->>'quantity')::numeric,
      (line->>'unit_id')::uuid,(line->>'estimated_rate')::numeric,nullif(line->>'required_by','')::date,nullif(line->>'notes',''));
  END LOOP;
  IF _submit THEN PERFORM public.pr_transition(result_id,'submitted',NULL); END IF;
  INSERT INTO public.procurement_save_receipts(actor_id,request_id,operation,payload_hash,document_id)
    VALUES(actor,_request_id,'purchase_request',fingerprint,result_id);
  RETURN result_id;
END $$;
REVOKE ALL ON FUNCTION public.save_purchase_request(uuid,uuid,jsonb,jsonb,boolean,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_purchase_request(uuid,uuid,jsonb,jsonb,boolean,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_rfq_draft(_request_id uuid,_pr_id uuid,_header jsonb,_vendor_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.purchase_requests; result_id uuid; fingerprint text; receipt public.procurement_save_receipts;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(),'rfq.create') THEN RAISE EXCEPTION 'No permission to create RFQs'; END IF;
  IF _request_id IS NULL OR jsonb_typeof(_header) IS DISTINCT FROM 'object'
    OR cardinality(_vendor_ids) IS NULL OR cardinality(_vendor_ids) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Choose between 1 and 100 suppliers'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||_request_id::text,0));
  SELECT * INTO p FROM public.purchase_requests WHERE id=_pr_id FOR SHARE;
  IF NOT FOUND OR NOT public.actor_in_company(p.company_id) OR NOT public.can_access_project(auth.uid(),p.project_id) THEN
    RAISE EXCEPTION 'Request is not accessible'; END IF;
  fingerprint := encode(sha256(convert_to(jsonb_build_object('pr',_pr_id,'header',_header,'vendors',_vendor_ids)::text,'UTF8')),'hex');
  SELECT * INTO receipt FROM public.procurement_save_receipts WHERE actor_id=auth.uid() AND request_id=_request_id;
  IF FOUND THEN
    IF receipt.operation<>'rfq' OR receipt.payload_hash<>fingerprint THEN RAISE EXCEPTION 'This save token was already used for different content'; END IF;
    PERFORM 1 FROM public.rfqs WHERE id=receipt.document_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'This draft was deleted by a Super Admin. Start a new request instead of retrying the deleted draft'; END IF;
    RETURN /* checked document */ receipt.document_id;
  END IF;
  IF p.status<>'approved' THEN RAISE EXCEPTION 'Choose an approved purchase request'; END IF;
  IF (SELECT count(DISTINCT v.id) FROM public.vendors v WHERE v.id=ANY(_vendor_ids)
      AND v.company_id=p.company_id AND v.status='active')<>cardinality(_vendor_ids) THEN
    RAISE EXCEPTION 'Each supplier must be distinct, active and in this company'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.purchase_request_items WHERE purchase_request_id=p.id) THEN
    RAISE EXCEPTION 'The approved request has no items'; END IF;
  INSERT INTO public.rfqs(purchase_request_id,company_id,project_id,building_id,response_due_date,required_by_date,remarks,created_by)
  VALUES(p.id,p.company_id,p.project_id,p.building_id,(_header->>'response_due_date')::date,p.required_by,
    nullif(btrim(_header->>'remarks'),''),auth.uid()) RETURNING id INTO result_id;
  INSERT INTO public.rfq_items(rfq_id,pr_item_id,line_no,material_id,description,requested_quantity,unit_id,target_rate,required_by)
    SELECT result_id,id,line_no,material_id,description,quantity,unit_id,estimated_rate,required_by
    FROM public.purchase_request_items WHERE purchase_request_id=p.id ORDER BY line_no,id;
  INSERT INTO public.rfq_vendors(rfq_id,vendor_id) SELECT result_id,unnest(_vendor_ids);
  INSERT INTO public.procurement_save_receipts(actor_id,request_id,operation,payload_hash,document_id)
    VALUES(auth.uid(),_request_id,'rfq',fingerprint,result_id);
  RETURN result_id;
END $$;
REVOKE ALL ON FUNCTION public.create_rfq_draft(uuid,uuid,jsonb,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_rfq_draft(uuid,uuid,jsonb,uuid[]) TO authenticated;
