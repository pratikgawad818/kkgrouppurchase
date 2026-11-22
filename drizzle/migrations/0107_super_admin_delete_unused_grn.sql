-- 0107: Safe permanent deletion of an unused or unposted cancelled GRN.
-- Super Admin only. Existing posted receipts, stock, invoices and accounting
-- are protected. Preserve the complete deleted receipt and line snapshot in
-- append-only audit history. No existing records are changed by this migration.
CREATE OR REPLACE FUNCTION public.super_admin_delete_unused_grn(
  _grn_id uuid, _reason text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  actor public.profiles%ROWTYPE;
  receipt public.goods_receipt_notes%ROWTYPE;
  normalized_reason text;
  snapshot jsonb;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id=auth.uid();
  IF actor.id IS NULL OR NOT actor.is_active OR
    NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only an active Super Admin can permanently delete GRNs';
  END IF;

  normalized_reason := btrim(coalesce(_reason,''));
  IF char_length(normalized_reason)<3 OR char_length(normalized_reason)>500 THEN
    RAISE EXCEPTION 'Enter a deletion reason (3–500 characters)';
  END IF;

  -- Serialize with posting, cancellation and concurrent deletion.
  SELECT * INTO receipt FROM public.goods_receipt_notes
  WHERE id=_grn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRN not found or already deleted'; END IF;
  IF receipt.company_id IS DISTINCT FROM actor.company_id THEN
    RAISE EXCEPTION 'You can delete GRNs only within your own company';
  END IF;
  IF receipt.status NOT IN ('draft','cancelled') OR
    receipt.posted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only never-posted draft or cancelled GRNs can be deleted';
  END IF;

  -- Check both direct GRN links and line-level links, even for inconsistent
  -- historical entries. Any one dependency stops the entire transaction.
  IF EXISTS (
      SELECT 1 FROM public.inventory_transactions tx
      WHERE tx.grn_id=receipt.id OR tx.grn_item_id IN
        (SELECT id FROM public.goods_receipt_items WHERE grn_id=receipt.id)
    ) OR EXISTS (
      SELECT 1 FROM public.vendor_invoice_items inv
      WHERE inv.grn_id=receipt.id OR inv.grn_item_id IN
        (SELECT id FROM public.goods_receipt_items WHERE grn_id=receipt.id)
    ) OR EXISTS (
      SELECT 1 FROM public.journal_entries j WHERE j.source_id=receipt.id
    ) THEN
    RAISE EXCEPTION 'GRN has stock, invoice, or accounting history and must not be deleted';
  END IF;

  SELECT jsonb_build_object(
    'header',to_jsonb(receipt),
    'items',coalesce((SELECT jsonb_agg(to_jsonb(line) ORDER BY line.id)
      FROM public.goods_receipt_items line WHERE line.grn_id=receipt.id),'[]'::jsonb)
  ) INTO snapshot;

  -- This explicit event remains after the GRN and its draft lines are gone.
  PERFORM public.log_event(
    'grn_permanently_deleted','GRN',receipt.grn_number,receipt.id,
    normalized_reason,snapshot,NULL,'purchase_order',receipt.po_id
  );

  DELETE FROM public.goods_receipt_items WHERE grn_id=receipt.id;
  DELETE FROM public.goods_receipt_notes WHERE id=receipt.id;
  -- No PO quantity, warehouse stock, inventory transaction, supplier invoice,
  -- payment or accounting table is updated by this function.
END
$function$;

REVOKE ALL ON FUNCTION public.super_admin_delete_unused_grn(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_delete_unused_grn(uuid,text)
  TO authenticated;
COMMENT ON FUNCTION public.super_admin_delete_unused_grn(uuid,text) IS
'Only active same-company Super Admin may permanently delete never-posted GRN drafts/cancelled receipts without linked stock, invoice or accounting, retaining full deletion snapshot in audit_logs.';
