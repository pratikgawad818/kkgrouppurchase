-- 0076: Two-stage, auditable correction route for POs awaiting Director review.
-- A return is NOT a Director rejection vote. Keep existing po_status values,
-- so current PO edit/resubmission paths and accounting guards stay operational.
ALTER TYPE public.po_action ADD VALUE IF NOT EXISTS 'returned';

-- A completed, quotation-linked PR cannot have its original lines deleted:
-- RFQ items retain foreign keys to those lines. A correction is instead a new
-- draft PR, linked to the original so the full procurement chain is traceable.
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS revision_of_pr_id uuid
    REFERENCES public.purchase_requests(id);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_requests_one_correction_per_origin
  ON public.purchase_requests(revision_of_pr_id)
  WHERE revision_of_pr_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.return_po_for_correction(
  _po_id uuid, _reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  doc public.purchase_orders%ROWTYPE;
  actor uuid := auth.uid();
  why text := nullif(btrim(coalesce(_reason,'')),'');
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor) OR NOT
     (public.has_role(actor,'director') OR public.has_role(actor,'super_admin')) THEN
    RAISE EXCEPTION 'Only an active Director or Super Admin can return a PO';
  END IF;
  IF why IS NULL OR length(why)<10 OR length(why)>2000 THEN
    RAISE EXCEPTION 'Enter a correction reason between 10 and 2000 characters';
  END IF;
  SELECT * INTO doc FROM public.purchase_orders WHERE id=_po_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_in_company(doc.company_id) OR
     NOT public.can_access_project(actor,doc.project_id) THEN
    RAISE EXCEPTION 'Purchase Order is not accessible';
  END IF;
  IF doc.status<>'pending_approval' THEN
    RAISE EXCEPTION 'Only a PO pending approval can be returned';
  END IF;
  IF EXISTS(SELECT 1 FROM public.vendor_invoices i WHERE i.po_id=_po_id)
     OR EXISTS(SELECT 1 FROM public.goods_receipt_notes g WHERE g.po_id=_po_id)
     OR EXISTS(SELECT 1 FROM public.vendor_delivery_challans d WHERE d.po_id=_po_id)
  THEN RAISE EXCEPTION 'PO with invoices or deliveries must be resolved through existing accounting workflows'; END IF;

  -- Rejected is the pre-existing editable/submit-capable PO state, while the
  -- separate 'returned' action preserves that this was NOT a rejection vote.
  UPDATE public.purchase_orders SET status='rejected',updated_at=now(),
    approved_by=NULL,approved_at=NULL WHERE id=_po_id;
  INSERT INTO public.purchase_order_approvals
    (po_id,action,acted_by,comment,previous_status,new_status,acted_at)
  VALUES(_po_id,'returned',actor,why,doc.status,'rejected',clock_timestamp());
  PERFORM public.log_event('po_returned','PO',doc.po_number,doc.id,why,
    jsonb_build_object('status',doc.status),
    jsonb_build_object('status','rejected','correction_target','purchase_manager'));
END $$;
REVOKE ALL ON FUNCTION public.return_po_for_correction(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.return_po_for_correction(uuid,text) TO authenticated;

-- A Purchase Manager may escalate a returned PO to the original Site Engineer.
-- That route *retires* the old PO/RFQ cycle before returning PR items to draft.
-- Original vendor quotes, purchase-order records and audit events remain intact.
CREATE OR REPLACE FUNCTION public.return_pr_to_site_engineer_from_po(
  _po_id uuid, _reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  doc public.purchase_orders%ROWTYPE;
  req public.purchase_requests%ROWTYPE;
  actor uuid := auth.uid();
  why text := nullif(btrim(coalesce(_reason,'')),'');
  last_action public.po_action;
  successor uuid;
  successor_number text;
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor) OR
     NOT public.has_role(actor,'purchase_manager') OR
     NOT public.has_permission(actor,'purchase_request.approve') OR
     NOT public.has_permission(actor,'purchase_order.cancel') THEN
    RAISE EXCEPTION 'Only an authorized Purchase Manager can return a PR to its Site Engineer';
  END IF;
  IF why IS NULL OR length(why)<10 OR length(why)>2000 THEN
    RAISE EXCEPTION 'Enter a correction reason between 10 and 2000 characters';
  END IF;
  SELECT * INTO doc FROM public.purchase_orders WHERE id=_po_id FOR UPDATE;
  IF NOT FOUND OR doc.status<>'rejected' OR
     NOT public.actor_in_company(doc.company_id) OR
     NOT public.can_access_project(actor,doc.project_id) THEN
    RAISE EXCEPTION 'A returned PO is required to escalate correction';
  END IF;
  SELECT action INTO last_action FROM public.purchase_order_approvals
  WHERE po_id=_po_id ORDER BY acted_at DESC,id DESC LIMIT 1;
  IF last_action IS DISTINCT FROM 'returned'::public.po_action THEN
    RAISE EXCEPTION 'PO must first be returned by a Director or Super Admin';
  END IF;
  SELECT * INTO req FROM public.purchase_requests
  WHERE id=doc.purchase_request_id FOR UPDATE;
  IF NOT FOUND OR req.status<>'approved' OR req.company_id<>doc.company_id OR
     req.project_id<>doc.project_id OR req.requested_by=actor OR
     NOT public.has_role(req.requested_by,'site_engineer') OR
     NOT public.can_access_project(req.requested_by,req.project_id) THEN
    RAISE EXCEPTION 'The original approved Site Engineer request is not eligible for return';
  END IF;
  -- One active purchase cycle per returned request. Never roll back a PR with
  -- another purchasing commitment or with any invoice/delivery evidence.
  IF EXISTS(SELECT 1 FROM public.purchase_orders p
            WHERE p.purchase_request_id=req.id AND p.id<>doc.id AND p.status<>'cancelled')
    OR EXISTS(SELECT 1 FROM public.vendor_invoices i
              JOIN public.purchase_orders p ON p.id=i.po_id WHERE p.purchase_request_id=req.id)
    OR EXISTS(SELECT 1 FROM public.goods_receipt_notes g
              JOIN public.purchase_orders p ON p.id=g.po_id WHERE p.purchase_request_id=req.id)
    OR EXISTS(SELECT 1 FROM public.vendor_delivery_challans d
              JOIN public.purchase_orders p ON p.id=d.po_id WHERE p.purchase_request_id=req.id)
  THEN RAISE EXCEPTION 'Linked POs, invoices or goods receipts require manual reconciliation before returning the PR'; END IF;

  -- Existing PO cancellation routine preserves normal status audit and guards.
  PERFORM public.po_transition(doc.id,'cancelled',
    'Escalated to original Site Engineer for PR correction: '||why);
  -- Preserve actual intra-transaction order even when the entire workflow
  -- occurs inside one test/client transaction (now() is transaction-stable).
  UPDATE public.purchase_order_approvals
  SET acted_at=clock_timestamp()
  WHERE id=(
    SELECT a.id FROM public.purchase_order_approvals a
    WHERE a.po_id=doc.id AND a.action='cancelled'
    ORDER BY a.acted_at DESC,a.id DESC LIMIT 1
  );
  -- RFQs are historic evidence, not to be reused after the underlying PR
  -- changes. Cancellation makes it impossible to create a PO from old quotes.
  PERFORM set_config('app.rfq_source','rpc',true);
  UPDATE public.rfqs
  SET status='cancelled',
      remarks=concat_ws(E'\n',nullif(remarks,''),
        'Cancelled after Purchase Manager returned '||req.pr_number||' for correction: '||why)
  WHERE purchase_request_id=req.id AND status<>'cancelled';
  PERFORM set_config('app.rfq_source','',true);

  -- The original approved PR and its item FK rows are NEVER rewritten.
  -- Mark it archived, then clone only its requested materials into a linked,
  -- editable draft owned by the same Site Engineer.
  PERFORM set_config('app.pr_source','rpc',true);
  UPDATE public.purchase_requests SET status='cancelled',updated_at=now()
  WHERE id=req.id;
  PERFORM set_config('app.pr_source','',true);

  INSERT INTO public.purchase_requests(
    pr_number,company_id,project_id,building_id,floor_id,requested_by,
    required_by,priority,request_type,purpose,remarks,attachment_path,
    revision_of_pr_id
  ) VALUES (
    'auto',req.company_id,req.project_id,req.building_id,req.floor_id,
    req.requested_by,req.required_by,req.priority,req.request_type,
    req.purpose,concat_ws(E'\n',nullif(req.remarks,''),
      'Correction required after '||doc.po_number||': '||why),
    req.attachment_path,req.id
  ) RETURNING id,pr_number INTO successor,successor_number;

  INSERT INTO public.purchase_request_items(
    purchase_request_id,line_no,material_id,description,quantity,unit_id,
    estimated_rate,required_by,purpose,notes
  )
  SELECT successor,line_no,material_id,description,quantity,unit_id,
         estimated_rate,required_by,purpose,notes
  FROM public.purchase_request_items
  WHERE purchase_request_id=req.id ORDER BY line_no;

  INSERT INTO public.purchase_request_approvals
    (purchase_request_id,action,acted_by,comment,previous_status,new_status,acted_at)
  VALUES(req.id,'cancelled',actor,
    'Superseded by '||successor_number||' after return from '||doc.po_number||': '||why,
    req.status,'cancelled',clock_timestamp());

  INSERT INTO public.purchase_request_approvals
    (purchase_request_id,action,acted_by,comment,previous_status,new_status,acted_at)
  VALUES(successor,'returned',actor,
    'Correction draft created from '||req.pr_number||' / '||doc.po_number||': '||why,
    'draft','draft',clock_timestamp());

  INSERT INTO public.notifications(user_id,title,body,link)
  VALUES(req.requested_by,'Purchase Request needs correction',
    'Purchase Manager returned '||doc.po_number||'. '||why||
    '. Open '||successor_number||' to correct the materials and resubmit.',
    '/procurement/purchase-requests/'||successor::text);

  PERFORM public.log_event('pr_correction_revision_created','PR',successor_number,
    successor,why,jsonb_build_object('previous_pr',req.pr_number,'po',doc.po_number),
    jsonb_build_object('status','draft','requester',req.requested_by));
  RETURN successor;
END $$;
REVOKE ALL ON FUNCTION public.return_pr_to_site_engineer_from_po(uuid,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.return_pr_to_site_engineer_from_po(uuid,text)
  TO authenticated;
