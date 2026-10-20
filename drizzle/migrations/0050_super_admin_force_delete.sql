CREATE OR REPLACE FUNCTION public.audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND TG_TABLE_NAME<>'audit_logs' AND current_setting('app.force_delete',true)='on' THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Audit history is permanent and cannot be changed or deleted';
END $$;

CREATE OR REPLACE FUNCTION public._force_delete_rows(_tab regclass, _ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ref record; child_ids uuid[]; has_id boolean;
BEGIN
 IF _ids IS NULL OR array_length(_ids,1) IS NULL THEN RETURN; END IF;
 INSERT INTO _fd_seen(tab,id) SELECT _tab::text, x FROM unnest(_ids) x ON CONFLICT DO NOTHING;
 FOR ref IN
  SELECT c.conrelid::regclass AS child, a.attname
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
  JOIN pg_namespace ns ON ns.oid=(SELECT relnamespace FROM pg_class WHERE oid=c.conrelid)
  WHERE c.contype='f' AND c.confrelid=_tab AND ns.nspname='public' AND array_length(c.conkey,1)=1
 LOOP
  SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=ref.child AND attname='id' AND NOT attisdropped) INTO has_id;
  IF ref.child='public.inventory_transactions'::regclass THEN
   EXECUTE format('UPDATE public.warehouse_stock ws SET quantity_on_hand=ws.quantity_on_hand-d.q, total_value=GREATEST(0,(ws.quantity_on_hand-d.q))*ws.weighted_avg_cost, updated_at=now() FROM (SELECT warehouse_id,material_id,sum(coalesce(quantity_in,0)-coalesce(quantity_out,0)) q FROM public.inventory_transactions WHERE %I=ANY($1) AND id NOT IN (SELECT id FROM _fd_seen WHERE tab=%L) GROUP BY 1,2) d WHERE ws.warehouse_id=d.warehouse_id AND ws.material_id=d.material_id', ref.attname, ref.child::text) USING _ids;
  END IF;
  IF has_id THEN
   EXECUTE format('SELECT array_agg(id) FROM %s WHERE %I=ANY($1) AND id NOT IN (SELECT id FROM _fd_seen WHERE tab=%L)', ref.child, ref.attname, ref.child::text) INTO child_ids USING _ids;
   IF ref.child='public.vendor_payment_allocations'::regclass OR ref.child='public.vendor_advance_adjustments'::regclass THEN
    INSERT INTO _fd_invoices SELECT invoice_id FROM public.vendor_payment_allocations WHERE id=ANY(coalesce(child_ids,'{}')) ON CONFLICT DO NOTHING;
   END IF;
   PERFORM public._force_delete_rows(ref.child, child_ids);
  ELSE
   EXECUTE format('DELETE FROM %s WHERE %I=ANY($1)', ref.child, ref.attname) USING _ids;
  END IF;
 END LOOP;
 DELETE FROM public.journal_lines WHERE journal_entry_id IN (SELECT id FROM public.journal_entries WHERE source_id=ANY(_ids));
 DELETE FROM public.journal_entries WHERE source_id=ANY(_ids);
 EXECUTE format('DELETE FROM %s WHERE id=ANY($1)', _tab) USING _ids;
END $$;
REVOKE ALL ON FUNCTION public._force_delete_rows(regclass,uuid[]) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.super_admin_force_delete(_kind text, _id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor public.profiles%ROWTYPE; tab text; target jsonb; inv uuid; po uuid;
BEGIN
 SELECT * INTO actor FROM public.profiles WHERE id=auth.uid();
 IF actor.id IS NULL OR NOT actor.is_active OR NOT public.has_role(auth.uid(),'super_admin') THEN RAISE EXCEPTION 'Only an active Super Admin can permanently delete records.'; END IF;
 tab := CASE _kind WHEN 'material' THEN 'items' WHEN 'purchase_request' THEN 'purchase_requests' WHEN 'rfq' THEN 'rfqs'
  WHEN 'vendor_quotation' THEN 'vendor_quotations' WHEN 'purchase_order' THEN 'purchase_orders' WHEN 'delivery_challan' THEN 'vendor_delivery_challans'
  WHEN 'goods_receipt' THEN 'goods_receipt_notes' WHEN 'material_issue' THEN 'material_issues' WHEN 'material_return' THEN 'material_returns'
  WHEN 'vendor_invoice' THEN 'vendor_invoices' WHEN 'vendor_payment' THEN 'vendor_payments' WHEN 'small_expense' THEN 'site_small_expenses' ELSE NULL END;
 IF tab IS NULL THEN RAISE EXCEPTION 'Unsupported deletion type.'; END IF;
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',tab) INTO target USING _id;
 IF target IS NULL THEN RAISE EXCEPTION 'Record not found or already deleted.'; END IF;
 IF (target->>'company_id')::uuid IS DISTINCT FROM actor.company_id THEN RAISE EXCEPTION 'You can delete records only in your own company.'; END IF;
 PERFORM public.log_event('permanently_deleted',tab,coalesce(target->>'pr_number',target->>'rfq_number',target->>'po_number',target->>'grn_number',target->>'invoice_number',target->>'payment_number',target->>'issue_number',target->>'name',_id::text),_id,'Super Admin force deletion (cascade)',target,NULL,NULL,NULL);
 CREATE TEMP TABLE IF NOT EXISTS _fd_seen(tab text, id uuid, PRIMARY KEY(tab,id)) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _fd_invoices(id uuid PRIMARY KEY) ON COMMIT DROP;
 PERFORM set_config('app.force_delete','on',true);
 po := nullif(target->>'po_id','')::uuid;
 IF target ? 'invoice_id' THEN INSERT INTO _fd_invoices VALUES ((target->>'invoice_id')::uuid) ON CONFLICT DO NOTHING; END IF;
 INSERT INTO _fd_invoices SELECT invoice_id FROM public.vendor_payment_allocations WHERE payment_id=_id ON CONFLICT DO NOTHING;
 PERFORM public._force_delete_rows(('public.'||tab)::regclass, ARRAY[_id]);
 PERFORM set_config('app.force_delete','off',true);
 FOR inv IN SELECT f.id FROM _fd_invoices f JOIN public.vendor_invoices v ON v.id=f.id LOOP PERFORM public.vi_refresh_balance(inv); END LOOP;
 IF po IS NOT NULL AND EXISTS(SELECT 1 FROM public.purchase_orders WHERE id=po) THEN PERFORM public.po_refresh_status(po); END IF;
END $$;
REVOKE ALL ON FUNCTION public.super_admin_force_delete(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.super_admin_force_delete(text,uuid) TO authenticated;