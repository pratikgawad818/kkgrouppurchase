-- 0111: PR-originating Site Engineer receives a bell/opted-in phone alert
-- for each *persisted* procurement handoff. This is additive to the existing
-- Director approval/PR receipt triggers and preserves their approval logic.
-- Notification targets NEVER include all engineers assigned to the project.
-- No historical business documents or notifications are backfilled.

-- Only trusted triggers can enqueue a notification, after checking that the
-- original requester is an active Site Engineer in the same company and still
-- has access to the exact project. The notification link is supplied only by
-- our internal trigger bodies; web push is handled by the existing dispatcher.
CREATE OR REPLACE FUNCTION public.notify_pr_original_site_engineer(
  _pr_id uuid,_company uuid,_project uuid,_title text,_body text,_link text
) RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
  INSERT INTO public.notifications(user_id,title,body,link)
  SELECT original.id,left(_title,170),left(_body,900),_link
  FROM public.purchase_requests pr
  JOIN public.profiles original
    ON original.id=pr.requested_by
    AND original.company_id=_company AND original.is_active
  JOIN public.projects project
    ON project.id=pr.project_id AND project.company_id=pr.company_id
  WHERE pr.id=_pr_id AND pr.company_id=_company AND pr.project_id=_project
    AND public.has_role(original.id,'site_engineer')
    AND public.has_permission(original.id,'purchase_request.view')
    AND public.can_access_project(original.id,_project);
$function$;
REVOKE ALL ON FUNCTION public.notify_pr_original_site_engineer(uuid,uuid,uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;

-- Preserve the existing PR reviewer notification; only add a submission
-- confirmation for the requester, and attribute PR receipt to the *actual*
-- approving role. PO Director approval is still a separate stage.
CREATE OR REPLACE FUNCTION public.notify_on_pr_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
DECLARE
  receipt_title text;
  actor_name text;
  role_name text;
  project_name text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT left(coalesce(nullif(btrim(name),''),'Project'),70)
    INTO project_name FROM public.projects WHERE id=NEW.project_id AND company_id=NEW.company_id;
  IF NEW.status='pending_approval' THEN
    PERFORM public.notify_document_approvers(
      'purchase_request.approve',NEW.company_id,NEW.project_id,NEW.requested_by,
      'Purchase request '||NEW.pr_number||' needs review',
      'Review the requested materials and required date',
      '/procurement/purchase-requests/'||NEW.id
    );
    PERFORM public.notify_pr_original_site_engineer(
      NEW.id,NEW.company_id,NEW.project_id,
      'PR requested • '||NEW.pr_number,
      'Your request for '||coalesce(project_name,'Project')||
        ' was submitted and is awaiting procurement review.',
      '/procurement/purchase-requests/'||NEW.id
    );
  ELSIF NEW.status='approved' THEN
    SELECT left(nullif(btrim(p.full_name),''),70)
      INTO actor_name FROM public.profiles p
      WHERE p.id=NEW.approved_by AND p.company_id=NEW.company_id AND p.is_active;
    role_name := CASE
      WHEN NEW.approved_by IS NOT NULL AND public.has_role(NEW.approved_by,'purchase_manager')
        THEN 'Purchase Manager'
      WHEN NEW.approved_by IS NOT NULL AND public.has_role(NEW.approved_by,'super_admin')
        THEN 'Super Admin'
      WHEN NEW.approved_by IS NOT NULL AND public.has_role(NEW.approved_by,'director')
        THEN 'Director'
      ELSE 'Authorized reviewer'
    END;
    receipt_title := CASE
      WHEN actor_name IS NOT NULL THEN
        'PR received for procurement by '||actor_name||' ('||role_name||')'
      ELSE 'PR received for procurement'
    END;
    -- The existing callback already notifies ALL authorized PR creators;
    -- retain it for non-engineer requesters, without adding a duplicate.
    PERFORM public.notify_document_creator(
      NEW.requested_by,NEW.company_id,NEW.project_id,
      receipt_title||' • '||NEW.pr_number,
      '/procurement/purchase-requests/'||NEW.id
    );
    -- No second engineer notification here: this IS the milestone alert.
  ELSIF NEW.status='rejected' THEN
    PERFORM public.notify_document_creator(
      NEW.requested_by,NEW.company_id,NEW.project_id,
      'Purchase request '||NEW.pr_number||' was rejected',
      '/procurement/purchase-requests/'||NEW.id
    );
  ELSIF NEW.status='cancelled' THEN
    PERFORM public.notify_pr_original_site_engineer(
      NEW.id,NEW.company_id,NEW.project_id,
      'PR cancelled • '||NEW.pr_number,
      'This request for '||coalesce(project_name,'Project')||' was cancelled.',
      '/procurement/purchase-requests/'||NEW.id
    );
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.notify_on_pr_status() FROM PUBLIC,anon,authenticated;

-- The existing PO status trigger already notifies the Directors when
-- submitted and notifies the original PR engineer when a Director approves.
-- This second trigger adds ONLY the engineer's "submitted for approval"
-- handoff and corrections. Triggered solely by genuine status transitions.
CREATE OR REPLACE FUNCTION public.notify_pr_engineer_po_handoff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
DECLARE
  pr_number text;
  project_name text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT pr.pr_number,p.name INTO pr_number,project_name
  FROM public.purchase_requests pr JOIN public.projects p
    ON p.id=pr.project_id AND p.company_id=pr.company_id
  WHERE pr.id=NEW.purchase_request_id AND pr.project_id=NEW.project_id
    AND pr.company_id=NEW.company_id;
  IF pr_number IS NULL THEN RETURN NEW; END IF;
  IF NEW.status='pending_approval' THEN
    PERFORM public.notify_pr_original_site_engineer(
      NEW.purchase_request_id,NEW.company_id,NEW.project_id,
      'PO sent for Director approval • '||NEW.po_number,
      'PR '||pr_number||' • '||left(project_name,70)||
        ' • The PO is waiting for a Director decision.',
      '/procurement/purchase-orders/'||NEW.id
    );
  ELSIF NEW.status='rejected' THEN
    PERFORM public.notify_pr_original_site_engineer(
      NEW.purchase_request_id,NEW.company_id,NEW.project_id,
      'PO returned for correction • '||NEW.po_number,
      'PR '||pr_number||' • '||left(project_name,70)||
        ' • Procurement must correct this PO before proceeding.',
      '/procurement/purchase-orders/'||NEW.id
    );
  ELSIF NEW.status='cancelled' THEN
    PERFORM public.notify_pr_original_site_engineer(
      NEW.purchase_request_id,NEW.company_id,NEW.project_id,
      'PO cancelled • '||NEW.po_number,
      'PR '||pr_number||' • '||left(project_name,70)||
        ' • This PO will not proceed to delivery.',
      '/procurement/purchase-orders/'||NEW.id
    );
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS notify_pr_engineer_po_handoff_status ON public.purchase_orders;
CREATE TRIGGER notify_pr_engineer_po_handoff_status
  AFTER UPDATE OF status ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_pr_engineer_po_handoff();
REVOKE ALL ON FUNCTION public.notify_pr_engineer_po_handoff()
  FROM PUBLIC,anon,authenticated;

-- Vendor challans reference PO, not PR. Derive PR identity only through
-- company/project-matched PO linkage. One alert per actual registered challan
-- (one PO may legitimately receive many challans). No duplicate on edits.
CREATE OR REPLACE FUNCTION public.notify_pr_engineer_challan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
DECLARE
  po record;
BEGIN
  IF NEW.status <> 'registered' OR
    (TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN
    RETURN NEW;
  END IF;
  SELECT o.purchase_request_id,o.po_number,pr.pr_number,p.name AS project_name
    INTO po
  FROM public.purchase_orders o
  JOIN public.purchase_requests pr
    ON pr.id=o.purchase_request_id AND pr.company_id=o.company_id
       AND pr.project_id=o.project_id
  JOIN public.projects p ON p.id=o.project_id AND p.company_id=o.company_id
  WHERE o.id=NEW.po_id AND o.company_id=NEW.company_id
    AND o.project_id=NEW.project_id;
  IF po.purchase_request_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.notify_pr_original_site_engineer(
    po.purchase_request_id,NEW.company_id,NEW.project_id,
    'Delivery challan recorded • '||left(NEW.challan_number,90),
    'PR '||po.pr_number||' • '||left(po.project_name,70)||
      ' • PO '||po.po_number||' • Supplier challan registered. Goods receipt can follow.',
    '/inventory/delivery-challans/'||NEW.id
  );
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS notify_pr_engineer_challan_registered ON public.vendor_delivery_challans;
CREATE TRIGGER notify_pr_engineer_challan_registered
  AFTER INSERT OR UPDATE OF status ON public.vendor_delivery_challans
  FOR EACH ROW EXECUTE FUNCTION public.notify_pr_engineer_challan();
REVOKE ALL ON FUNCTION public.notify_pr_engineer_challan()
  FROM PUBLIC,anon,authenticated;

-- A GRN draft means site delivery has been recorded but is NOT posted to
-- inventory. On posting, send a separate confirmed update, never mark the
-- draft as "stock received". Status-only guards prevent edit-trigger spam.
CREATE OR REPLACE FUNCTION public.notify_pr_engineer_grn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
DECLARE
  po record;
BEGIN
  IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
    THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('draft','posted','cancelled')
    THEN RETURN NEW; END IF;
  SELECT o.purchase_request_id,o.po_number,pr.pr_number,p.name AS project_name
    INTO po
  FROM public.purchase_orders o
  JOIN public.purchase_requests pr
    ON pr.id=o.purchase_request_id AND pr.company_id=o.company_id
      AND pr.project_id=o.project_id
  JOIN public.projects p ON p.id=o.project_id AND p.company_id=o.company_id
  WHERE o.id=NEW.po_id AND o.company_id=NEW.company_id
    AND o.project_id=NEW.project_id;
  IF po.purchase_request_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.notify_pr_original_site_engineer(
    po.purchase_request_id,NEW.company_id,NEW.project_id,
    CASE NEW.status
      WHEN 'draft' THEN 'Goods receipt draft recorded • '||NEW.grn_number
      WHEN 'posted' THEN 'Goods received and posted • '||NEW.grn_number
      ELSE 'Goods receipt cancelled • '||NEW.grn_number
    END,
    'PR '||po.pr_number||' • '||left(po.project_name,70)||
      ' • PO '||po.po_number||
      CASE NEW.status
        WHEN 'draft' THEN ' • Received quantities are awaiting stock posting.'
        WHEN 'posted' THEN ' • Goods receipt verified and posted to stock.'
        ELSE ' • Receipt cancelled; review the delivery and stock reversal.'
      END,
    '/inventory/goods-received/'||NEW.id
  );
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS notify_pr_engineer_grn_stage ON public.goods_receipt_notes;
CREATE TRIGGER notify_pr_engineer_grn_stage
  AFTER INSERT OR UPDATE OF status ON public.goods_receipt_notes
  FOR EACH ROW EXECUTE FUNCTION public.notify_pr_engineer_grn();
REVOKE ALL ON FUNCTION public.notify_pr_engineer_grn()
  FROM PUBLIC,anon,authenticated;

COMMENT ON FUNCTION public.notify_pr_original_site_engineer(uuid,uuid,uuid,text,text,text) IS
'Internal only. Bell and opted-in web-push messages to the original active PR Site Engineer, only with same-company assigned-project access; never whole site team.';
