CREATE OR REPLACE FUNCTION public.grn_item_available(_grn_item uuid, _exclude_invoice uuid)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT gi.accepted_quantity - coalesce((SELECT sum(vii.quantity) FROM vendor_invoice_items vii
     JOIN vendor_invoices vi ON vi.id = vii.invoice_id
     WHERE vii.grn_item_id = _grn_item AND vi.status NOT IN ('rejected','cancelled')
       AND (_exclude_invoice IS NULL OR vi.id <> _exclude_invoice)),0)
  FROM goods_receipt_items gi JOIN goods_receipt_notes g ON g.id = gi.grn_id
  WHERE gi.id = _grn_item
    AND public.actor_in_company(g.company_id)
    AND public.can_access_project(auth.uid(), g.project_id)
$function$;

CREATE OR REPLACE FUNCTION public.apply_vendor_advance(_advance_id uuid, _invoice_id uuid, _amount numeric)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE adv record; inv record; used numeric; open_alloc numeric; aid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT has_permission(auth.uid(),'payment.record') THEN RAISE EXCEPTION 'No permission to adjust advances'; END IF;
  SELECT * INTO adv FROM vendor_payments WHERE id = _advance_id FOR UPDATE;
  SELECT * INTO inv FROM vendor_invoices WHERE id = _invoice_id FOR UPDATE;
  IF adv IS NULL OR inv IS NULL
     OR NOT public.actor_in_company(adv.company_id) OR NOT public.actor_in_company(inv.company_id)
     OR adv.company_id <> inv.company_id
     OR (adv.project_id IS NOT NULL AND NOT public.can_access_project(auth.uid(), adv.project_id))
     OR (inv.project_id IS NOT NULL AND NOT public.can_access_project(auth.uid(), inv.project_id))
  THEN RAISE EXCEPTION 'Advance or invoice not found'; END IF;
  IF adv.kind <> 'advance' OR adv.status <> 'recorded' THEN RAISE EXCEPTION 'Advance must be recorded before it can be adjusted'; END IF;
  IF inv.vendor_id <> adv.vendor_id THEN RAISE EXCEPTION 'Invoice belongs to a different vendor'; END IF;
  IF inv.status NOT IN ('approved','partially_paid') THEN RAISE EXCEPTION 'Invoice is not open for payment'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Enter an amount'; END IF;
  SELECT coalesce(sum(amount),0) INTO used FROM vendor_advance_adjustments WHERE advance_payment_id = _advance_id;
  IF _amount > adv.amount - used THEN RAISE EXCEPTION 'Only % of this advance is left', adv.amount - used; END IF;
  SELECT coalesce(sum(al.amount),0) INTO open_alloc FROM vendor_payment_allocations al JOIN vendor_payments p ON p.id = al.payment_id
    WHERE al.invoice_id = inv.id AND p.status IN ('scheduled','approved');
  IF _amount > inv.balance_due - open_alloc THEN RAISE EXCEPTION 'Invoice has only % left to settle', inv.balance_due - open_alloc; END IF;
  INSERT INTO vendor_advance_adjustments(advance_payment_id, invoice_id, amount, created_by) VALUES (_advance_id, _invoice_id, _amount, auth.uid()) RETURNING id INTO aid;
  PERFORM post_journal(inv.company_id, (now() AT TIME ZONE 'Asia/Kolkata')::date, 'advance_adjustment', aid, inv.vendor_id, inv.project_id,
    'Advance ' || adv.payment_number || ' adjusted against ' || inv.invoice_number,
    jsonb_build_array(jsonb_build_object('code','2100','debit',_amount), jsonb_build_object('code','1500','credit',_amount)));
  PERFORM vi_refresh_balance(_invoice_id);
END $function$;