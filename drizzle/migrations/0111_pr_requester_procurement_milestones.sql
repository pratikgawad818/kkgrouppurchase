-- Notify only the original active PR requester when actual downstream
-- procurement milestones occur. This is additive: existing approval queue
-- and PO-approval notifications remain owned by their existing triggers.
-- Notifications use the existing in-app inbox / opt-in push pipeline.
CREATE OR REPLACE FUNCTION public.notify_pr_requester_milestone(
  _pr_id uuid, _company uuid, _project uuid, _title text, _body text
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  INSERT INTO public.notifications(user_id,title,body,link)
  SELECT p.id, left(_title,200), left(_body,600),
    '/procurement/purchase-requests/'||pr.id
  FROM public.purchase_requests pr
  JOIN public.profiles p ON p.id=pr.requested_by
    AND p.company_id=pr.company_id AND p.is_active
  WHERE pr.id=_pr_id AND pr.company_id=_company AND pr.project_id=_project
    AND public.has_role(p.id,'site_engineer')
    AND public.has_permission(p.id,'purchase_request.view')
    AND public.can_access_project(p.id,pr.project_id);
$$;
REVOKE ALL ON FUNCTION public.notify_pr_requester_milestone(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;

-- Notify once for each meaningful RFQ stage, not routine edits.
CREATE OR REPLACE FUNCTION public.notify_requester_on_rfq_milestone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pr_no text; project_name text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('sent','ready_for_po') THEN RETURN NEW; END IF;
  SELECT pr.pr_number, project.name INTO pr_no,project_name
  FROM public.purchase_requests pr
  JOIN public.projects project ON project.id=pr.project_id
    AND project.company_id=pr.company_id
  WHERE pr.id=NEW.purchase_request_id AND pr.company_id=NEW.company_id
    AND pr.project_id=NEW.project_id;
  IF pr_no IS NOT NULL THEN
    PERFORM public.notify_pr_requester_milestone(
      NEW.purchase_request_id,NEW.company_id,NEW.project_id,
      CASE WHEN NEW.status='sent' THEN 'Quotation requested • '||pr_no
        ELSE 'Quotation stage completed • '||pr_no END,
      NEW.rfq_number||' • '||project_name||
        CASE WHEN NEW.status='sent' THEN ' • RFQ sent to suppliers'
          ELSE ' • Ready to prepare purchase order' END
    );
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_requester_on_rfq_milestone() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notify_requester_rfq_milestone ON public.rfqs;
CREATE TRIGGER notify_requester_rfq_milestone AFTER UPDATE OF status ON public.rfqs
FOR EACH ROW EXECUTE FUNCTION public.notify_requester_on_rfq_milestone();

-- The Director-approved PO milestone has its own existing trigger.
-- This one only covers approval submission and vendor dispatch.
CREATE OR REPLACE FUNCTION public.notify_requester_on_po_milestone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pr_no text; project_name text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('pending_approval','sent') THEN RETURN NEW; END IF;
  SELECT pr.pr_number,project.name INTO pr_no,project_name
  FROM public.purchase_requests pr
  JOIN public.projects project ON project.id=pr.project_id
    AND project.company_id=pr.company_id
  WHERE pr.id=NEW.purchase_request_id AND pr.company_id=NEW.company_id
    AND pr.project_id=NEW.project_id;
  IF pr_no IS NOT NULL THEN
    PERFORM public.notify_pr_requester_milestone(
      NEW.purchase_request_id,NEW.company_id,NEW.project_id,
      CASE WHEN NEW.status='pending_approval' THEN 'PO sent for Director approval • '||pr_no
        ELSE 'Purchase order sent to supplier • '||pr_no END,
      NEW.po_number||' • '||project_name||
        CASE WHEN NEW.status='pending_approval' THEN ' • Awaiting Director decision'
          ELSE ' • Supplier dispatch stage' END
    );
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_requester_on_po_milestone() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notify_requester_po_milestone ON public.purchase_orders;
CREATE TRIGGER notify_requester_po_milestone AFTER UPDATE OF status ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.notify_requester_on_po_milestone();

-- Registered challans are evidence of expected goods, not proof of receipt.
CREATE OR REPLACE FUNCTION public.notify_requester_on_challan_milestone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p record;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'registered' THEN RETURN NEW; END IF;
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status<>'cancelled' THEN
    RETURN NEW;
  END IF;
  SELECT po.purchase_request_id,po.po_number INTO p
  FROM public.purchase_orders po WHERE po.id=NEW.po_id
    AND po.company_id=NEW.company_id AND po.project_id=NEW.project_id;
  IF p.purchase_request_id IS NOT NULL THEN
    PERFORM public.notify_pr_requester_milestone(
      p.purchase_request_id, NEW.company_id, NEW.project_id,
      CASE WHEN NEW.status='cancelled' THEN 'Delivery challan cancelled'
        ELSE 'Delivery challan registered' END,
      'Challan '||NEW.challan_number||' • PO '||p.po_number||
      CASE WHEN NEW.status='cancelled' THEN ' • No longer active'
        ELSE ' • Goods receipt verification pending' END
    );
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_requester_on_challan_milestone() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notify_requester_challan_milestone ON public.vendor_delivery_challans;
CREATE TRIGGER notify_requester_challan_milestone AFTER INSERT OR UPDATE OF status
ON public.vendor_delivery_challans FOR EACH ROW
EXECUTE FUNCTION public.notify_requester_on_challan_milestone();

-- A draft GRN is not verified stock. Announce only posting or cancellation.
CREATE OR REPLACE FUNCTION public.notify_requester_on_grn_milestone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p record;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR
     NEW.status NOT IN ('posted','cancelled') THEN RETURN NEW; END IF;
  SELECT po.purchase_request_id,po.po_number INTO p
  FROM public.purchase_orders po WHERE po.id=NEW.po_id
    AND po.company_id=NEW.company_id AND po.project_id=NEW.project_id;
  IF p.purchase_request_id IS NOT NULL THEN
    PERFORM public.notify_pr_requester_milestone(
      p.purchase_request_id,NEW.company_id,NEW.project_id,
      CASE WHEN NEW.status='posted' THEN 'Goods receipt posted'
        ELSE 'Goods receipt cancelled' END,
      NEW.grn_number||' • PO '||p.po_number||
      CASE WHEN NEW.status='posted' THEN ' • Received quantities recorded'
        ELSE ' • Review updated delivery status' END
    );
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_requester_on_grn_milestone() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notify_requester_grn_milestone ON public.goods_receipt_notes;
CREATE TRIGGER notify_requester_grn_milestone AFTER UPDATE OF status
ON public.goods_receipt_notes FOR EACH ROW
EXECUTE FUNCTION public.notify_requester_on_grn_milestone();

COMMENT ON FUNCTION public.notify_pr_requester_milestone(uuid,uuid,uuid,text,text)
IS 'Scoped to original active site-engineer PR requester, with same company/project and current PR viewing access. Inserts a safe PR-detail inbox link; push delivery requires opt-in.';