-- 0112: Fill only gaps left by the deployed 0111 stage notifications.
-- Do NOT reinstall PR, Director approval, PO handoff, challan registration,
-- or GRN notifications: they are already active in production.
-- The common function below is defined by 0111_pr_requester_stage_notifications.
-- All messages are scoped to the original active Site Engineer and original PR.
-- No business rows are changed or historical notifications backfilled.

CREATE OR REPLACE FUNCTION public.notify_pr_engineer_rfq_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE
  pr_number text;
  project_name text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('sent','ready_for_po') THEN
    RETURN NEW;
  END IF;
  SELECT pr.pr_number, project.name
    INTO pr_number, project_name
  FROM public.purchase_requests pr
  JOIN public.projects project
    ON project.id=pr.project_id AND project.company_id=pr.company_id
  WHERE pr.id=NEW.purchase_request_id
    AND pr.company_id=NEW.company_id AND pr.project_id=NEW.project_id;
  IF pr_number IS NOT NULL THEN
    PERFORM public.notify_pr_original_site_engineer(
      NEW.purchase_request_id,NEW.company_id,NEW.project_id,
      CASE NEW.status
        WHEN 'sent' THEN 'Supplier quotations requested • '||NEW.rfq_number
        ELSE 'Quotations ready for PO • '||NEW.rfq_number
      END,
      'PR '||pr_number||' • '||left(project_name,70)||
      CASE NEW.status
        WHEN 'sent' THEN ' • RFQ sent to suppliers'
        ELSE ' • Procurement can prepare the PO'
      END,
      '/procurement/purchase-requests/'||NEW.purchase_request_id
    );
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.notify_pr_engineer_rfq_progress() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notify_pr_engineer_rfq_progress_stage ON public.rfqs;
CREATE TRIGGER notify_pr_engineer_rfq_progress_stage
AFTER UPDATE OF status ON public.rfqs
FOR EACH ROW EXECUTE FUNCTION public.notify_pr_engineer_rfq_progress();

-- 0111 already sends 'PO sent for Director approval' and Director decisions.
-- Only notify the additional 'sent to supplier' transition here.
CREATE OR REPLACE FUNCTION public.notify_pr_engineer_po_vendor_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE
  pr_number text;
  project_name text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status<>'sent' THEN
    RETURN NEW;
  END IF;
  SELECT pr.pr_number,project.name
    INTO pr_number,project_name
  FROM public.purchase_requests pr
  JOIN public.projects project
    ON project.id=pr.project_id AND project.company_id=pr.company_id
  WHERE pr.id=NEW.purchase_request_id
    AND pr.company_id=NEW.company_id AND pr.project_id=NEW.project_id;
  IF pr_number IS NOT NULL THEN
    PERFORM public.notify_pr_original_site_engineer(
      NEW.purchase_request_id,NEW.company_id,NEW.project_id,
      'PO sent to supplier • '||NEW.po_number,
      'PR '||pr_number||' • '||left(project_name,70)||
      ' • Approved purchase order dispatched to supplier',
      '/procurement/purchase-orders/'||NEW.id
    );
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.notify_pr_engineer_po_vendor_dispatch() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notify_pr_engineer_po_vendor_dispatch_stage ON public.purchase_orders;
CREATE TRIGGER notify_pr_engineer_po_vendor_dispatch_stage
AFTER UPDATE OF status ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.notify_pr_engineer_po_vendor_dispatch();

-- 0111 notifies on registration, not cancellation. Cancellation is separately
-- important to the requester, without implying stock was ever received.
CREATE OR REPLACE FUNCTION public.notify_pr_engineer_challan_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $fn$
DECLARE
  po record;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status<>'cancelled' THEN
    RETURN NEW;
  END IF;
  SELECT o.purchase_request_id,o.po_number,pr.pr_number,p.name AS project_name
    INTO po
  FROM public.purchase_orders o
  JOIN public.purchase_requests pr
    ON pr.id=o.purchase_request_id AND pr.company_id=o.company_id
      AND pr.project_id=o.project_id
  JOIN public.projects p
    ON p.id=o.project_id AND p.company_id=o.company_id
  WHERE o.id=NEW.po_id AND o.company_id=NEW.company_id
    AND o.project_id=NEW.project_id;
  IF po.purchase_request_id IS NOT NULL THEN
    PERFORM public.notify_pr_original_site_engineer(
      po.purchase_request_id,NEW.company_id,NEW.project_id,
      'Supplier challan cancelled • '||left(NEW.challan_number,85),
      'PR '||po.pr_number||' • '||left(po.project_name,70)||
      ' • PO '||po.po_number||' • Delivery challan cancelled',
      '/procurement/purchase-orders/'||NEW.po_id
    );
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.notify_pr_engineer_challan_cancellation() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notify_pr_engineer_challan_cancellation_stage ON public.vendor_delivery_challans;
CREATE TRIGGER notify_pr_engineer_challan_cancellation_stage
AFTER UPDATE OF status ON public.vendor_delivery_challans
FOR EACH ROW EXECUTE FUNCTION public.notify_pr_engineer_challan_cancellation();
