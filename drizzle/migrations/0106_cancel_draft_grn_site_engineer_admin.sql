-- 0106: Allow staff to cancel only their own unposted GRN draft, and
-- Super Admin to cancel any unposted draft in the same company.
--
-- DO NOT grant grn.cancel to Site Engineers: the existing RPC allows
-- cancellation/reversal of posted stock, which must remain privileged.
-- This new, narrower RPC never touches stock balances or PO quantities.
-- Existing GRN and material/invoice records are preserved.
CREATE OR REPLACE FUNCTION public.cancel_draft_goods_receipt(
  _grn_id uuid, _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  g public.goods_receipt_notes%ROWTYPE;
  normalized_reason text;
  is_admin boolean;
  is_engineer boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not signed in or inactive';
  END IF;

  normalized_reason := btrim(coalesce(_reason,''));
  IF char_length(normalized_reason) < 3 OR char_length(normalized_reason) > 500 THEN
    RAISE EXCEPTION 'Enter a cancellation reason (3–500 characters)';
  END IF;

  is_admin := public.has_role(auth.uid(),'super_admin');
  is_engineer := public.has_role(auth.uid(),'site_engineer')
    AND public.has_permission(auth.uid(),'grn.create');

  IF NOT (is_admin OR is_engineer) THEN
    RAISE EXCEPTION 'Only the creating Site Engineer or Super Admin can cancel a GRN draft';
  END IF;

  -- Lock the exact GRN first. A concurrent posting transition cannot race
  -- with the draft-only cancellation and reverse stock by mistake.
  SELECT * INTO g
  FROM public.goods_receipt_notes WHERE id=_grn_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_in_company(g.company_id)
    OR NOT public.can_access_project(auth.uid(),g.project_id) THEN
    RAISE EXCEPTION 'GRN not found or project not assigned';
  END IF;

  IF g.status <> 'draft' THEN
    RAISE EXCEPTION 'Only unposted draft GRNs can be cancelled';
  END IF;
  IF NOT is_admin AND g.received_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can cancel only the draft GRNs you recorded';
  END IF;
  -- Fail closed on inconsistent historical records. Never reverse stock
  -- or cancel a draft that has become linked to accounting/stock.
  IF g.posted_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.inventory_transactions t WHERE t.grn_id=g.id
  ) OR EXISTS (
    SELECT 1 FROM public.vendor_invoice_items vii
    WHERE vii.grn_id=g.id
  ) THEN
    RAISE EXCEPTION 'GRN has stock or invoice activity and cannot be cancelled as a draft';
  END IF;

  UPDATE public.goods_receipt_notes
    SET status='cancelled', cancelled_by=auth.uid(), cancelled_at=now(),
        cancel_reason=normalized_reason
    WHERE id=g.id AND status='draft';

  PERFORM public.log_event(
    'grn_cancelled','GRN',g.grn_number,g.id,normalized_reason,
    jsonb_build_object('status','draft'),
    jsonb_build_object('status','cancelled','stock_changed',false),
    'purchase_order',g.po_id
  );
END
$function$;

REVOKE ALL ON FUNCTION public.cancel_draft_goods_receipt(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_draft_goods_receipt(uuid,text)
  TO authenticated;

COMMENT ON FUNCTION public.cancel_draft_goods_receipt(uuid,text) IS
'Site Engineers can cancel only their own assigned-project GRN drafts; Super Admin may cancel any same-company draft. Always audited. Never reverses posted stock or touches PO quantities.';
