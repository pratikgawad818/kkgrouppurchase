-- 0101: Director mobile/in-app PO alerts identify the original PR requester
-- and exact project, not merely the purchase manager who prepared the PO.
-- The same notifications row is used by the in-app bell and web-push sender.
-- No existing notifications, votes, PO statuses, or business data are changed.

CREATE OR REPLACE FUNCTION public.po_notification_context(_po_id uuid)
RETURNS TABLE(person_name text, project_name text, attribution text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT
    left(
      coalesce(
        nullif(btrim(requester.full_name), ''),
        CASE WHEN pr.id IS NOT NULL THEN 'Request creator'
          ELSE nullif(btrim(preparer.full_name), '') END,
        'Staff member'
      ), 40
    ) AS person_name,
    left(coalesce(nullif(btrim(project.name), ''), 'Unspecified project'), 45) AS project_name,
    CASE WHEN pr.id IS NOT NULL THEN 'Requested by' ELSE 'Prepared by' END AS attribution
  FROM public.purchase_orders po
  JOIN public.projects project ON project.id=po.project_id AND project.company_id=po.company_id
  LEFT JOIN public.purchase_requests pr ON pr.id=po.purchase_request_id
    AND pr.project_id=po.project_id AND pr.company_id=po.company_id
  LEFT JOIN public.profiles requester ON requester.id=pr.requested_by
    AND requester.company_id=po.company_id
  LEFT JOIN public.profiles preparer ON preparer.id=po.created_by
    AND preparer.company_id=po.company_id
  WHERE po.id=_po_id;
$$;
-- This privileged lookup is only for the secured trigger and reminder RPC.
-- It must not expose names or project links to arbitrary app users.
REVOKE ALL ON FUNCTION public.po_notification_context(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.notify_on_po_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ctx record;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status='pending_approval' THEN
      SELECT * INTO ctx FROM public.po_notification_context(NEW.id);
      PERFORM public.notify_document_approvers(
        'purchase_order.approve',NEW.company_id,NEW.project_id,NEW.created_by,
        'PO approval • '||coalesce(ctx.person_name,'Staff member')||' • '||coalesce(ctx.project_name,'Project'),
        NEW.po_number||' • ₹'||to_char(coalesce(NEW.grand_total,0),'FM99,99,99,99,99,990.00')||
          ' • '||coalesce(ctx.attribution,'Prepared by')||' '||coalesce(ctx.person_name,'Staff member')||
          ' for '||coalesce(ctx.project_name,'Project'),
        '/approvals?kind=purchase_order&id='||NEW.id
      );
    ELSIF NEW.status IN ('approved','rejected') THEN
      PERFORM public.notify_document_creator(NEW.created_by,NEW.company_id,NEW.project_id,
        'Purchase order '||NEW.po_number||' was '||NEW.status::text,
        '/procurement/purchase-orders/'||NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_on_po_status() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.remind_po_approvers(_po_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  p public.purchase_orders;
  ctx record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) OR NOT (
    public.has_permission(auth.uid(),'purchase_order.create')
    OR public.has_permission(auth.uid(),'purchase_order.approve')
    OR EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id=auth.uid() AND r.role='super_admin'
    )
  ) THEN
    RAISE EXCEPTION 'No permission to send approval reminders';
  END IF;

  SELECT * INTO p FROM public.purchase_orders WHERE id=_po_id FOR UPDATE;
  IF NOT FOUND OR NOT public.po_can_view(p.id)
    OR NOT public.actor_in_company(p.company_id) THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  IF p.status<>'pending_approval' THEN
    RAISE EXCEPTION 'This purchase order is not waiting for approval';
  END IF;

  SELECT * INTO ctx FROM public.po_notification_context(p.id);

  INSERT INTO public.approval_reminder_events(po_id,actor_id)
    VALUES(p.id,auth.uid());

  PERFORM public.notify_document_approvers(
    'purchase_order.approve',p.company_id,p.project_id,auth.uid(),
    'PO reminder • '||coalesce(ctx.person_name,'Staff member')||' • '||coalesce(ctx.project_name,'Project'),
    p.po_number||' • ₹'||to_char(coalesce(p.grand_total,0),'FM99,99,99,99,99,990.00')||
      ' • '||coalesce(ctx.attribution,'Prepared by')||' '||coalesce(ctx.person_name,'Staff member')||
      ' for '||coalesce(ctx.project_name,'Project'),
    '/approvals?kind=purchase_order&id='||p.id
  );
END $$;
REVOKE ALL ON FUNCTION public.remind_po_approvers(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remind_po_approvers(uuid) TO authenticated;

COMMENT ON FUNCTION public.po_notification_context(uuid) IS
'Internal company-matched lookup: original linked purchase-request creator and project; falls back to PO preparer only for POs without a valid linked PR.';
