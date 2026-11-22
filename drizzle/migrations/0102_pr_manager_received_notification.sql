-- 0102: Clarify requester notifications without modifying PR/PO approval logic.
-- The PR state remains 'approved' internally to unlock RFQ creation. A PM
-- review is shown as receipt/acceptance, distinct from Director PO approval.
-- Existing notifications and business records remain unchanged.
CREATE OR REPLACE FUNCTION public.notify_on_pr_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  receipt_title text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status='pending_approval' THEN
      PERFORM public.notify_document_approvers(
        'purchase_request.approve',NEW.company_id,NEW.project_id,NEW.requested_by,
        'Purchase request '||NEW.pr_number||' needs review',
        'Review the requested materials and required date',
        '/procurement/purchase-requests/'||NEW.id
      );
    ELSIF NEW.status='approved' THEN
      -- Only attribute the receipt to Purchase Manager when the actual actor
      -- has that role. Director-origin PRs and other authorized approvers
      -- must not be misrepresented as Purchase Manager actions.
      receipt_title := CASE
        WHEN NEW.approved_by IS NOT NULL
         AND public.has_role(NEW.approved_by,'purchase_manager')
          THEN 'Purchase Manager received your request'
        ELSE 'Your purchase request was accepted for procurement'
      END;
      PERFORM public.notify_document_creator(
        NEW.requested_by,NEW.company_id,NEW.project_id,
        receipt_title||' • '||NEW.pr_number,
        '/procurement/purchase-requests/'||NEW.id
      );
    ELSIF NEW.status='rejected' THEN
      PERFORM public.notify_document_creator(
        NEW.requested_by,NEW.company_id,NEW.project_id,
        'Purchase request '||NEW.pr_number||' was rejected',
        '/procurement/purchase-requests/'||NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Only the attached trigger should invoke this SECURITY DEFINER function.
REVOKE ALL ON FUNCTION public.notify_on_pr_status() FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION public.notify_on_pr_status() IS
'PR receive/acceptance notifications: Purchase Manager wording only for a verified purchase_manager actor. Director PO approval remains separate.';
