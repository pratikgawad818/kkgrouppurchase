-- 0113: Award only the RFQ lines actually being procured.
-- Keep the full originating PR and source supplier quotation unchanged.
-- Skipped PR lines are NOT fulfilled/closed automatically; their disposition
-- must be explained and handled separately (stock, another RFQ, or short-close).
-- Replaces only the existing protected award RPC; no business data is rewritten.
CREATE OR REPLACE FUNCTION public.record_vendor_selection(
  _rfq_id uuid, _selections jsonb, _reason text
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  r public.rfqs%ROWTYPE;
  s jsonb;
  qi record;
  selected_item_ids uuid[] := ARRAY[]::uuid[];
  n integer := 0;
  total_items integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Active sign-in required';
  END IF;
  IF NOT public.has_permission(auth.uid(),'quotation.select_vendor') THEN
    RAISE EXCEPTION 'No permission to select vendors';
  END IF;
  SELECT * INTO r FROM public.rfqs WHERE id=_rfq_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_in_company(r.company_id)
    OR NOT public.can_access_project(auth.uid(),r.project_id) THEN
    RAISE EXCEPTION 'RFQ not found or project access revoked';
  END IF;
  IF r.status NOT IN ('partially_responded','fully_responded') THEN
    RAISE EXCEPTION 'RFQ has no quotations open for selection';
  END IF;
  IF _selections IS NULL OR jsonb_typeof(_selections) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Supply selected RFQ material lines';
  END IF;
  SELECT count(*) INTO total_items FROM public.rfq_items WHERE rfq_id=_rfq_id;
  IF jsonb_array_length(_selections) < 1
    OR jsonb_array_length(_selections) > total_items THEN
    RAISE EXCEPTION 'Select at least one and no more than all RFQ materials';
  END IF;
  IF length(btrim(coalesce(_reason,''))) < 3
    OR length(btrim(_reason)) > 1000 THEN
    RAISE EXCEPTION 'Selection reason must be between 3 and 1000 characters';
  END IF;
  IF jsonb_array_length(_selections) < total_items
    AND length(btrim(_reason)) < 15 THEN
    RAISE EXCEPTION 'Explain why unselected materials are not being purchased in this order (at least 15 characters)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vendor_selections WHERE rfq_id=_rfq_id)
    OR EXISTS (SELECT 1 FROM public.purchase_orders WHERE rfq_id=_rfq_id) THEN
    RAISE EXCEPTION 'Vendor selection or downstream order already exists';
  END IF;

  FOR s IN SELECT value FROM jsonb_array_elements(_selections) LOOP
    IF jsonb_typeof(s) IS DISTINCT FROM 'object'
      OR nullif(s->>'rfq_item_id','') IS NULL
      OR nullif(s->>'quotation_item_id','') IS NULL THEN
      RAISE EXCEPTION 'Every selected line needs an RFQ item and quotation item';
    END IF;
    SELECT i.*, q.vendor_id, q.status AS qstatus, q.valid_until,
      q.rfq_id AS qrfq
    INTO qi
    FROM public.vendor_quotation_items i
    JOIN public.vendor_quotations q ON q.id=i.quotation_id
    JOIN public.rfq_items item ON item.id=i.rfq_item_id AND item.rfq_id=q.rfq_id
    WHERE i.id=(s->>'quotation_item_id')::uuid;
    IF NOT FOUND OR qi.qrfq <> _rfq_id
      OR qi.rfq_item_id <> (s->>'rfq_item_id')::uuid THEN
      RAISE EXCEPTION 'Selected quotation does not belong to this RFQ item';
    END IF;
    IF qi.rfq_item_id=ANY(selected_item_ids) THEN
      RAISE EXCEPTION 'Cannot award the same RFQ material more than once';
    END IF;
    IF NOT qi.is_quoted OR qi.quoted_quantity IS NULL OR qi.quoted_quantity<=0 THEN
      RAISE EXCEPTION 'Cannot award a material that the supplier did not quote';
    END IF;
    IF qi.qstatus<>'submitted' THEN
      RAISE EXCEPTION 'Only submitted quotations can be awarded';
    END IF;
    IF qi.valid_until IS NOT NULL AND qi.valid_until<public.ist_today() THEN
      RAISE EXCEPTION 'A selected supplier quotation has expired';
    END IF;
    selected_item_ids:=array_append(selected_item_ids,qi.rfq_item_id);
    INSERT INTO public.vendor_selections
      (rfq_id,rfq_item_id,vendor_id,quotation_id,quotation_item_id,
       selected_quantity,awarded_rate,reason,selected_by)
    VALUES
      (_rfq_id,qi.rfq_item_id,qi.vendor_id,qi.quotation_id,qi.id,
       qi.quoted_quantity,qi.rate,btrim(_reason),auth.uid());
    n:=n+1;
  END LOOP;
  PERFORM set_config('app.rfq_source','rpc',true);
  UPDATE public.vendor_quotations SET status='selected'
    WHERE rfq_id=_rfq_id
      AND id IN (SELECT quotation_id FROM public.vendor_selections WHERE rfq_id=_rfq_id);
  UPDATE public.vendor_quotations SET status='rejected'
    WHERE rfq_id=_rfq_id AND status='submitted';
  UPDATE public.rfqs SET status='ready_for_po',selection_reason=btrim(_reason)
    WHERE id=_rfq_id;
  PERFORM set_config('app.rfq_source','',true);
  RETURN n;
END
$function$;
REVOKE ALL ON FUNCTION public.record_vendor_selection(uuid,jsonb,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_vendor_selection(uuid,jsonb,text)
  TO authenticated;
COMMENT ON FUNCTION public.record_vendor_selection(uuid,jsonb,text) IS
'Authorizes partial vendor awards with documented skipped materials; does not change the originating PR or auto-close unpurchased lines. Maintains existing secure RFQ-to-PO provenance.';
