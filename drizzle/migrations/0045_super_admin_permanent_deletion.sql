CREATE OR REPLACE FUNCTION public.super_admin_delete_record(_kind text, _id uuid, _check_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor public.profiles%ROWTYPE; target jsonb; tab text; label text; ref record; linked boolean; parent_oid oid;
BEGIN
 SELECT * INTO actor FROM public.profiles WHERE id=auth.uid() FOR SHARE;
 IF actor.id IS NULL OR NOT actor.is_active OR NOT public.has_role(auth.uid(),'super_admin') THEN RAISE EXCEPTION 'Only an active Super Admin can permanently delete records.'; END IF;
 tab := CASE _kind WHEN 'material' THEN 'items' WHEN 'purchase_request' THEN 'purchase_requests' WHEN 'rfq' THEN 'rfqs' WHEN 'user' THEN 'profiles' ELSE NULL END;
 IF tab IS NULL THEN RAISE EXCEPTION 'Unsupported deletion type.'; END IF;
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',tab) INTO target USING _id;
 IF target IS NULL THEN RAISE EXCEPTION 'Record not found or already deleted.'; END IF;
 IF actor.company_id IS NULL OR (target->>'company_id')::uuid IS DISTINCT FROM actor.company_id THEN RAISE EXCEPTION 'You can delete records only in your own company.'; END IF;
 IF _kind IN ('purchase_request','rfq') AND target->>'status' <> 'draft' THEN RAISE EXCEPTION 'Only unused drafts can be permanently deleted. Submitted documents retain their history.'; END IF;
 IF _kind='user' AND (_id=auth.uid() OR public.has_role(_id,'super_admin')) THEN RAISE EXCEPTION 'Your own account and Super Admin accounts cannot be deleted.'; END IF;
 parent_oid := to_regclass('public.'||tab);
 FOR ref IN
 SELECT ns.nspname,cl.relname,a.attname FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
 WHERE c.contype='f' AND c.confrelid=parent_oid AND NOT
 ((_kind='purchase_request' AND cl.relname='purchase_request_items' AND ns.nspname='public') OR
 (_kind='rfq' AND cl.relname IN ('rfq_items','rfq_vendors') AND ns.nspname='public') OR
 (_kind='user' AND cl.relname IN ('user_roles','user_project_assignments') AND ns.nspname='public'))
 LOOP
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I=$1)',ref.nspname,ref.relname,ref.attname) INTO linked USING _id;
 IF linked THEN RAISE EXCEPTION 'This record is linked to other records or history and cannot be permanently deleted.'; END IF;
 END LOOP;
 IF _kind='rfq' AND EXISTS(SELECT 1 FROM public.rfq_vendors WHERE rfq_id=_id AND status<>'pending') THEN RAISE EXCEPTION 'RFQs with vendor responses cannot be permanently deleted.'; END IF;
 IF _check_only THEN RETURN; END IF;
 label := coalesce(target->>'pr_number',target->>'rfq_number',target->>'name',target->>'full_name',target->>'email',_id::text);
 PERFORM public.log_event('permanently_deleted',tab,label,_id,'Super Admin confirmed permanent deletion',target,NULL);
 IF _kind='material' THEN DELETE FROM public.items WHERE id=_id;
 ELSIF _kind='purchase_request' THEN DELETE FROM public.purchase_requests WHERE id=_id;
 ELSIF _kind='rfq' THEN DELETE FROM public.rfqs WHERE id=_id;
 ELSE DELETE FROM public.profiles WHERE id=_id;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.super_admin_delete_record(text,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.super_admin_delete_record(text,uuid,boolean) TO authenticated;
COMMENT ON FUNCTION public.super_admin_delete_record(text,uuid,boolean) IS 'Super Admin permanent deletion: company-scoped, draft-only procurement, linked history protected; user auth deletion handled by authenticated server function.';