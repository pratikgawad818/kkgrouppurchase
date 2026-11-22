-- 0105: When a Director actually approves a PO, alert the Site Engineer
-- who originated the linked Purchase Request (not the PO preparer).
--
-- Uses the existing notifications -> pg_net -> web push pipeline; Site
-- Engineers opt into phone alerts from the bell. Never sends to other
-- engineers on the same site. No historical notifications are backfilled.
-- All previous approval, rejection, and Director reminder notifications stay.
CREATE OR REPLACE FUNCTION public.notify_on_po_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE ctx record; engineer_notified uuid;
BEGIN
  -- A status-only change triggers once; updates leaving status unchanged
  -- must not notify the engineer or dispatch another phone push.
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
      IF NEW.status='approved' AND NEW.approved_by IS NOT NULL THEN
        -- This is a *separate* recipient: only the original PR requester,
        -- only if that person is an active Site Engineer in the same
        -- company, currently assigned to this PO's project and allowed
        -- to open its details. Never notify every engineer at the project.
        -- Check the actual approved_by Director, not the PO creator.
        INSERT INTO public.notifications(user_id,title,body,link)
        SELECT requester.id,
          left(coalesce(nullif(btrim(approver.full_name),''),'Director'),70)||
            ' approved PO '||NEW.po_number,
          'Your purchase request '||pr.pr_number||
            ' • '||left(coalesce(nullif(btrim(project.name),''),'Project'),70)||
            ' • PO '||NEW.po_number||
            CASE WHEN vendor.id IS NOT NULL
              THEN ' • Supplier: '||left(vendor.company_name,90)
              ELSE '' END,
          '/procurement/purchase-orders/'||NEW.id
        FROM public.purchase_requests pr
        JOIN public.profiles requester
          ON requester.id=pr.requested_by
          AND requester.company_id=NEW.company_id AND requester.is_active
        JOIN public.profiles approver
          ON approver.id=NEW.approved_by
          AND approver.company_id=NEW.company_id AND approver.is_active
        JOIN public.projects project
          ON project.id=NEW.project_id AND project.company_id=NEW.company_id
        LEFT JOIN public.vendors vendor
          ON vendor.id=NEW.vendor_id AND vendor.company_id=NEW.company_id
        WHERE pr.id=NEW.purchase_request_id
          AND pr.company_id=NEW.company_id
          AND pr.project_id=NEW.project_id
          AND public.has_role(requester.id,'site_engineer')
          AND public.has_role(approver.id,'director')
          AND public.has_permission(requester.id,'purchase_order.view')
          AND public.can_access_project(requester.id,NEW.project_id)
        RETURNING user_id INTO engineer_notified;
      END IF;

      -- Preserve the existing message to the PO preparer; if the original
      -- engineer also prepared the order, the personalized approval alert
      -- above replaces the generic alert so they receive exactly one.
      IF NEW.created_by IS DISTINCT FROM engineer_notified THEN
        PERFORM public.notify_document_creator(
          NEW.created_by,NEW.company_id,NEW.project_id,
          'Purchase order '||NEW.po_number||' was '||NEW.status::text,
          '/procurement/purchase-orders/'||NEW.id
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.notify_on_po_status() FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION public.notify_on_po_status() IS
'Preserves Director approval queue and PO creator alerts; on approved status, additionally notifies the linked PR-originating Site Engineer with actual Director, PO, PR, project and supplier for inbox and opted-in phone push.';
