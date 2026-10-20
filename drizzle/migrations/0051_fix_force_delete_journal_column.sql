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
 DELETE FROM public.journal_lines WHERE entry_id IN (SELECT id FROM public.journal_entries WHERE source_id=ANY(_ids));
 DELETE FROM public.journal_entries WHERE source_id=ANY(_ids);
 EXECUTE format('DELETE FROM %s WHERE id=ANY($1)', _tab) USING _ids;
END $$;
REVOKE ALL ON FUNCTION public._force_delete_rows(regclass,uuid[]) FROM PUBLIC,anon,authenticated;