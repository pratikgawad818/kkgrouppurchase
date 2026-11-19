-- 0079: Real Director/Super Admin -> Purchase Manager -> Site Engineer
-- correction workflow. Existing issued POs, stock, invoices, supplier quotation
-- awards and approved source PRs are NOT rewritten or deleted.
-- The site engineer responds to a linked correction request; the Purchase
-- Manager checks supplier pricing and resolves it before PO resubmission.
CREATE TABLE public.po_site_correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  purchase_request_id uuid NOT NULL REFERENCES public.purchase_requests(id),
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  assigned_to uuid NOT NULL REFERENCES public.profiles(id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 2000),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','responded','resolved')),
  response text,
  responded_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id),
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status='requested' AND response IS NULL AND responded_at IS NULL AND resolved_at IS NULL)
    OR (status='responded' AND length(btrim(response))>=10 AND responded_at IS NOT NULL AND resolved_at IS NULL)
    OR (status='resolved' AND length(btrim(response))>=10 AND responded_at IS NOT NULL
      AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL
      AND length(btrim(resolution_note))>=5)
  )
);
CREATE UNIQUE INDEX po_site_corrections_one_open_idx
ON public.po_site_correction_requests(po_id) WHERE status<>'resolved';
CREATE INDEX po_site_corrections_engineer_idx ON public.po_site_correction_requests
  (assigned_to,status,created_at DESC);
CREATE INDEX po_site_corrections_pr_idx ON public.po_site_correction_requests
  (purchase_request_id,created_at DESC);

ALTER TABLE public.po_site_correction_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.po_site_correction_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.po_site_correction_requests TO authenticated;
GRANT ALL ON public.po_site_correction_requests TO service_role;
CREATE POLICY "Project teams read assigned PO correction requests"
ON public.po_site_correction_requests FOR SELECT TO authenticated
USING (
  public.actor_in_company(company_id)
  AND EXISTS (
    SELECT 1 FROM public.purchase_orders po
    WHERE po.id=po_id AND po.company_id=po_site_correction_requests.company_id
      AND public.can_access_project(auth.uid(),po.project_id)
      AND (
        public.po_can_view(po.id)
        OR (assigned_to=auth.uid() AND public.has_permission(auth.uid(),'purchase_request.view'))
      )
  )
);

-- Explicit Super Admin return without claiming a Director vote; normal
-- Directors still use the existing po_transition approval audit/decision code.
CREATE OR REPLACE FUNCTION public.return_po_for_correction(
  _po_id uuid,_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); p public.purchase_orders%ROWTYPE;
        reason_text text:=btrim(coalesce(_reason,''));
        admin_return boolean;
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor) OR
    length(reason_text) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'An active reviewer and clear correction reason are required'; END IF;
  SELECT * INTO p FROM public.purchase_orders WHERE id=_po_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_in_company(p.company_id)
    OR NOT public.can_access_project(actor,p.project_id)
    OR p.status<>'pending_approval' THEN
    RAISE EXCEPTION 'Only a pending, accessible PO can be returned for correction'; END IF;
  admin_return:=public.has_role(actor,'super_admin');
  IF admin_return THEN
    UPDATE public.purchase_orders SET status='rejected',updated_at=now(),
      approved_at=NULL,approved_by=NULL WHERE id=_po_id;
    INSERT INTO public.purchase_order_approvals
      (po_id,action,acted_by,comment,previous_status,new_status)
    VALUES (_po_id,'rejected',actor,reason_text,p.status,'rejected');
    PERFORM public.log_event('po_rejected','PO',p.po_number,p.id,reason_text,
      jsonb_build_object('status',p.status),jsonb_build_object('status','rejected'));
  ELSE
    IF NOT public.has_role(actor,'director') OR p.created_by=actor THEN
      RAISE EXCEPTION 'Only an independent Director or Super Admin can return a pending PO'; END IF;
    PERFORM public.po_transition(_po_id,'rejected'::public.po_action,reason_text);
  END IF;

  -- Notify every active Purchase Manager, including the PO creator when
  -- that person is the Manager responsible for correcting the order.
  INSERT INTO public.notifications(user_id,title,body,link)
  SELECT DISTINCT manager.id,
    'PO '||p.po_number||' returned for correction',
    reason_text,
    '/procurement/purchase-orders/'||p.id
  FROM public.user_roles roles
  JOIN public.profiles manager ON manager.id=roles.user_id
  WHERE roles.role='purchase_manager'
    AND manager.is_active AND manager.company_id=p.company_id
    AND public.can_access_project(manager.id,p.project_id);
  RETURN _po_id;
END $$;
REVOKE ALL ON FUNCTION public.return_po_for_correction(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.return_po_for_correction(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.escalate_rejected_po_to_site(
  _po_id uuid,_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid();
        p public.purchase_orders%ROWTYPE;
        pr public.purchase_requests%ROWTYPE;
        escalation_id uuid;
        reason_text text:=btrim(coalesce(_reason,''));
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor)
    OR NOT (public.has_role(actor,'purchase_manager') OR public.has_role(actor,'super_admin'))
    OR length(reason_text) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'A Purchase Manager or Super Admin must provide a correction reason'; END IF;
  SELECT * INTO p FROM public.purchase_orders WHERE id=_po_id FOR UPDATE;
  IF NOT FOUND OR p.status<>'rejected'
    OR NOT public.actor_in_company(p.company_id)
    OR NOT public.can_access_project(actor,p.project_id) THEN
    RAISE EXCEPTION 'Only an accessible returned PO can be escalated'; END IF;
  IF EXISTS (SELECT 1 FROM public.goods_receipt_notes WHERE po_id=p.id)
    OR EXISTS (SELECT 1 FROM public.vendor_delivery_challans WHERE po_id=p.id)
    OR EXISTS (SELECT 1 FROM public.vendor_invoices WHERE po_id=p.id)
  THEN RAISE EXCEPTION 'PO already has delivery or accounting history'; END IF;

  SELECT * INTO pr FROM public.purchase_requests WHERE id=p.purchase_request_id FOR UPDATE;
  IF NOT FOUND OR pr.company_id<>p.company_id OR pr.project_id<>p.project_id
     OR pr.status<>'approved'
     OR NOT EXISTS (
       SELECT 1 FROM public.profiles person
       JOIN public.user_roles role ON role.user_id=person.id
       WHERE person.id=pr.requested_by AND person.is_active
         AND person.company_id=p.company_id AND role.role='site_engineer'
     ) THEN
    RAISE EXCEPTION 'Original PR must be an approved request from an active Site Engineer'; END IF;
  IF EXISTS (SELECT 1 FROM public.po_site_correction_requests
      WHERE po_id=_po_id AND status<>'resolved') THEN
    RAISE EXCEPTION 'This PO already has an open Site Engineer correction request'; END IF;
  INSERT INTO public.po_site_correction_requests(
    company_id,po_id,purchase_request_id,requested_by,assigned_to,reason
  ) VALUES (p.company_id,p.id,pr.id,actor,pr.requested_by,reason_text)
  RETURNING id INTO escalation_id;
  INSERT INTO public.notifications(user_id,title,body,link)
  VALUES(pr.requested_by,
    'Site correction needed: '||pr.pr_number||' / '||p.po_number,
    reason_text,
    '/procurement/purchase-requests/'||pr.id);
  PERFORM public.log_event('po_site_correction_requested','PO',p.po_number,p.id,
    reason_text,NULL,jsonb_build_object('site_correction_id',escalation_id,'assigned_to',pr.requested_by));
  RETURN escalation_id;
END $$;
REVOKE ALL ON FUNCTION public.escalate_rejected_po_to_site(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.escalate_rejected_po_to_site(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_po_site_correction(
  _correction_id uuid,_response text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); ticket public.po_site_correction_requests%ROWTYPE;
        reply text:=btrim(coalesce(_response,''));
        po public.purchase_orders%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor) OR
    length(reply) NOT BETWEEN 10 AND 4000 THEN
    RAISE EXCEPTION 'Site Engineer must enter a response of 10 to 4000 characters'; END IF;
  SELECT * INTO ticket FROM public.po_site_correction_requests WHERE id=_correction_id FOR UPDATE;
  IF NOT FOUND OR ticket.status<>'requested' OR ticket.assigned_to<>actor
    OR NOT public.actor_in_company(ticket.company_id)
    OR NOT public.has_role(actor,'site_engineer') THEN
    RAISE EXCEPTION 'Only the assigned Site Engineer can respond to an open request'; END IF;
  SELECT * INTO po FROM public.purchase_orders WHERE id=ticket.po_id FOR UPDATE;
  IF po.status<>'rejected' OR NOT public.can_access_project(actor,po.project_id) THEN
    RAISE EXCEPTION 'PO is no longer awaiting correction'; END IF;
  UPDATE public.po_site_correction_requests
    SET status='responded',response=reply,responded_at=now()
    WHERE id=ticket.id;
  INSERT INTO public.notifications(user_id,title,body,link)
    VALUES(ticket.requested_by,'Site Engineer replied: '||po.po_number,reply,
      '/procurement/purchase-orders/'||po.id);
  PERFORM public.log_event('po_site_correction_responded','PO',po.po_number,po.id,
    reply,NULL,jsonb_build_object('site_correction_id',ticket.id));
  RETURN ticket.id;
END $$;
REVOKE ALL ON FUNCTION public.respond_po_site_correction(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.respond_po_site_correction(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_po_site_correction(
  _correction_id uuid,_resolution text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); ticket public.po_site_correction_requests%ROWTYPE;
        po public.purchase_orders%ROWTYPE;
        note text:=btrim(coalesce(_resolution,''));
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor)
    OR NOT (public.has_role(actor,'purchase_manager') OR public.has_role(actor,'super_admin'))
    OR length(note) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'Purchase Manager must describe how the correction was resolved'; END IF;
  SELECT * INTO ticket FROM public.po_site_correction_requests WHERE id=_correction_id FOR UPDATE;
  IF NOT FOUND OR ticket.status<>'responded'
    OR NOT public.actor_in_company(ticket.company_id) THEN
    RAISE EXCEPTION 'The engineer must respond before the correction can be resolved'; END IF;
  SELECT * INTO po FROM public.purchase_orders WHERE id=ticket.po_id FOR UPDATE;
  IF po.status<>'rejected' OR NOT public.can_access_project(actor,po.project_id) THEN
    RAISE EXCEPTION 'PO is no longer returned for correction'; END IF;
  UPDATE public.po_site_correction_requests SET
    status='resolved',resolved_by=actor,resolved_at=now(),resolution_note=note
    WHERE id=ticket.id;
  INSERT INTO public.notifications(user_id,title,body,link)
    VALUES(ticket.assigned_to,'PO correction reviewed: '||po.po_number,note,
      '/procurement/purchase-orders/'||po.id);
  PERFORM public.log_event('po_site_correction_resolved','PO',po.po_number,po.id,
    note,NULL,jsonb_build_object('site_correction_id',ticket.id));
  RETURN ticket.id;
END $$;
REVOKE ALL ON FUNCTION public.resolve_po_site_correction(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_po_site_correction(uuid,text) TO authenticated;

-- Block ordinary or Director-origin resubmission while a Site Engineer
-- correction is open, including manual client/REST updates.
CREATE OR REPLACE FUNCTION public.guard_unresolved_po_site_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
    AND OLD.status='rejected'
    AND NEW.status IN ('pending_approval','approved')
    AND EXISTS (
      SELECT 1 FROM public.po_site_correction_requests
      WHERE po_id=OLD.id AND status<>'resolved'
    ) THEN
    RAISE EXCEPTION 'Resolve the Site Engineer correction request before resubmitting this PO'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_unresolved_po_site_correction ON public.purchase_orders;
CREATE TRIGGER guard_unresolved_po_site_correction
BEFORE UPDATE OF status ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.guard_unresolved_po_site_correction();
