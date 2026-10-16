-- A retry reuses its receipt; a failed transaction leaves neither header nor lines behind.
CREATE TABLE public.procurement_save_receipts (
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  request_id uuid NOT NULL,
  operation text NOT NULL,
  payload_hash text NOT NULL,
  document_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, request_id)
);
ALTER TABLE public.procurement_save_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.procurement_save_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.procurement_save_receipts TO service_role;

CREATE FUNCTION public.save_purchase_request(
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
    RETURN receipt.document_id;
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

CREATE FUNCTION public.create_rfq_draft(_request_id uuid,_pr_id uuid,_header jsonb,_vendor_ids uuid[])
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
    RETURN receipt.document_id;
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
