-- Seven calendar days' notice; exceptions remain available with a recorded reason.
-- No backfill: historical submissions remain unclassified. First submission evidence is immutable.
ALTER TABLE public.purchase_requests
 ADD COLUMN IF NOT EXISTS short_notice_reason text,
 ADD COLUMN IF NOT EXISTS first_notice_days integer,
 ADD COLUMN IF NOT EXISTS first_notice_required_by date,
 ADD COLUMN IF NOT EXISTS first_notice_submitted_on date,
 ADD COLUMN IF NOT EXISTS first_notice_reason text;

CREATE OR REPLACE FUNCTION public.pr_capture_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE effective_due date; submitted_on date; notice integer;
BEGIN
 IF TG_OP='INSERT' THEN
   NEW.first_notice_days:=NULL; NEW.first_notice_required_by:=NULL;
   NEW.first_notice_submitted_on:=NULL; NEW.first_notice_reason:=NULL;
   RETURN NEW;
 END IF;
 NEW.first_notice_days:=OLD.first_notice_days;
 NEW.first_notice_required_by:=OLD.first_notice_required_by;
 NEW.first_notice_submitted_on:=OLD.first_notice_submitted_on;
 NEW.first_notice_reason:=OLD.first_notice_reason;
 IF coalesce(current_setting('app.pr_source',true),'')='rpc'
    AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    AND NEW.status IN ('pending_approval','approved') THEN
   submitted_on := (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
   SELECT least(NEW.required_by,coalesce(min(i.required_by),NEW.required_by))
      INTO effective_due FROM public.purchase_request_items i WHERE i.purchase_request_id=NEW.id;
   notice := effective_due-submitted_on;
   IF notice<7 AND length(btrim(coalesce(NEW.short_notice_reason,''))) NOT BETWEEN 10 AND 1000 THEN
     RAISE EXCEPTION 'Requests with less than 7 days notice require a reason of 10 to 1000 characters.';
   END IF;
   IF OLD.first_notice_days IS NULL THEN
     NEW.first_notice_days:=notice;
     NEW.first_notice_required_by:=effective_due;
     NEW.first_notice_submitted_on:=submitted_on;
     NEW.first_notice_reason:=CASE WHEN notice<7 THEN btrim(NEW.short_notice_reason) ELSE NULL END;
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pr_capture_notice() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zz_pr_capture_notice ON public.purchase_requests;
CREATE TRIGGER zz_pr_capture_notice BEFORE INSERT OR UPDATE ON public.purchase_requests
 FOR EACH ROW EXECUTE FUNCTION public.pr_capture_notice();

CREATE OR REPLACE FUNCTION public.save_purchase_request(_request_id uuid, _id uuid, _header jsonb, _items jsonb, _submit boolean DEFAULT false, _expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      required_by,priority,request_type,purpose,remarks,short_notice_reason)
    VALUES ('auto',project_company,h.project_id,h.building_id,h.floor_id,actor,h.required_by,
      coalesce(h.priority,'normal'),coalesce(h.request_type,'material'),nullif(btrim(h.purpose),''),nullif(btrim(h.remarks),''),nullif(btrim(h.short_notice_reason),''))
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
      purpose=nullif(btrim(h.purpose),''),remarks=nullif(btrim(h.remarks),''),short_notice_reason=nullif(btrim(h.short_notice_reason),'') WHERE id=_id;
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
END $function$;

CREATE OR REPLACE FUNCTION public.pr_transition(_pr_id uuid, _action pr_action, _comment text DEFAULT NULL::text)
 RETURNS pr_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p purchase_requests%ROWTYPE; v_uid uuid := auth.uid(); v_new pr_status; v_items int; v_director_origin boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT is_active_user(v_uid) THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO p FROM purchase_requests WHERE id = _pr_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase request not found.'; END IF;
  IF NOT public.actor_in_company(p.company_id) OR NOT public.can_access_project(v_uid,p.project_id) THEN RAISE EXCEPTION 'You do not have access to this project.'; END IF;
  _comment := nullif(trim(coalesce(_comment,'')), '');

  IF _action = 'submitted' THEN
    v_director_origin := p.requested_by=v_uid AND public.has_role(v_uid,'director') AND NOT public.has_role(v_uid,'super_admin') AND public.actor_in_company(p.company_id);
    IF p.status <> 'draft' AND NOT(p.status='pending_approval' AND v_director_origin) THEN RAISE EXCEPTION 'Only draft requests can be submitted.'; END IF;
    IF p.requested_by <> v_uid OR NOT has_permission(v_uid,'purchase_request.submit') THEN RAISE EXCEPTION 'You cannot submit this request.'; END IF;
    SELECT count(*) INTO v_items FROM purchase_request_items WHERE purchase_request_id = _pr_id;
    IF v_items = 0 THEN RAISE EXCEPTION 'Add at least one item before submitting.'; END IF;
    IF coalesce(trim(p.purpose),'') = '' THEN RAISE EXCEPTION 'Purpose is required before submitting.'; END IF;
    v_new := CASE WHEN v_director_origin THEN 'approved'::pr_status ELSE 'pending_approval'::pr_status END;
  ELSIF _action IN ('approved','returned') THEN
    IF p.status <> 'pending_approval' THEN RAISE EXCEPTION 'Only pending requests can be approved or returned.'; END IF;
    IF NOT has_permission(v_uid,'purchase_request.approve') THEN RAISE EXCEPTION 'You do not have permission to approve.'; END IF;
    IF p.requested_by = v_uid THEN RAISE EXCEPTION 'You cannot approve or return your own request.'; END IF;
    IF _action = 'returned' AND _comment IS NULL THEN RAISE EXCEPTION 'A comment is required when returning a request.'; END IF;
    v_new := CASE WHEN _action = 'approved' THEN 'approved'::pr_status ELSE 'draft'::pr_status END;
  ELSIF _action = 'rejected' THEN
    IF p.status <> 'pending_approval' THEN RAISE EXCEPTION 'Only pending requests can be rejected.'; END IF;
    IF NOT has_permission(v_uid,'purchase_request.reject') THEN RAISE EXCEPTION 'You do not have permission to reject.'; END IF;
    IF p.requested_by = v_uid THEN RAISE EXCEPTION 'You cannot reject your own request.'; END IF;
    IF _comment IS NULL THEN RAISE EXCEPTION 'A reason is required when rejecting.'; END IF;
    v_new := 'rejected';
  ELSIF _action = 'cancelled' THEN
    IF p.status NOT IN ('draft','pending_approval') THEN RAISE EXCEPTION 'Only draft or pending requests can be cancelled.'; END IF;
    IF NOT has_permission(v_uid,'purchase_request.cancel') THEN RAISE EXCEPTION 'You do not have permission to cancel.'; END IF;
    IF p.requested_by <> v_uid AND NOT has_permission(v_uid,'purchase_request.approve') THEN RAISE EXCEPTION 'Only the requester or an approver can cancel.'; END IF;
    v_new := 'cancelled';
  ELSE
    RAISE EXCEPTION 'Unsupported action.';
  END IF;

  PERFORM set_config('app.pr_source', 'rpc', true);
  UPDATE purchase_requests SET status = v_new,
    short_notice_reason = CASE WHEN _action='submitted' THEN coalesce(_comment,short_notice_reason) ELSE short_notice_reason END,
    submitted_at = CASE WHEN _action = 'submitted' THEN now() ELSE submitted_at END,
    submitted_by = CASE WHEN _action = 'submitted' THEN v_uid ELSE submitted_by END,
    approved_at = CASE WHEN _action = 'approved' OR v_director_origin THEN now() ELSE approved_at END,
    approved_by = CASE WHEN _action = 'approved' OR v_director_origin THEN v_uid ELSE approved_by END
  WHERE id = _pr_id;
  PERFORM set_config('app.pr_source', '', true);
  INSERT INTO purchase_request_approvals(purchase_request_id, action, acted_by, comment, previous_status, new_status)
  VALUES (_pr_id, _action, v_uid, _comment, p.status, v_new);
  IF v_director_origin THEN
    INSERT INTO purchase_request_approvals(purchase_request_id,action,acted_by,comment,previous_status,new_status)
    VALUES(_pr_id,'approved',v_uid,'Finalized by the requesting Director; no additional approval required.',p.status,v_new);
  END IF;
  RETURN v_new;
END $function$;
