CREATE OR REPLACE FUNCTION public.guard_staff_permanent_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Staff accounts must be deleted through the protected account deletion action.'; END IF;
 IF EXISTS(SELECT 1 FROM public.unit_status_history WHERE changed_by=OLD.id) OR EXISTS(SELECT 1 FROM public.audit_logs WHERE user_id=OLD.id) THEN RAISE EXCEPTION 'This staff account has recorded history and cannot be permanently deleted.'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER guard_staff_permanent_delete BEFORE DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_staff_permanent_delete();
CREATE OR REPLACE FUNCTION public.finalize_staff_permanent_delete(_actor_id uuid,_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=_actor_id AND is_active AND company_id IS NOT NULL) OR NOT public.has_role(_actor_id,'super_admin') THEN RAISE EXCEPTION 'Only an active Super Admin can permanently delete records.'; END IF;
 PERFORM set_config('request.jwt.claim.sub',_actor_id::text,true);
 PERFORM public.super_admin_delete_record('user',_id,false);
END $$;
REVOKE ALL ON FUNCTION public.finalize_staff_permanent_delete(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_staff_permanent_delete(uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.guard_procurement_permanent_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.procurement_save_receipts WHERE document_id=OLD.id) THEN RAISE EXCEPTION 'This document has a saved-operation history and cannot be permanently deleted.'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER guard_pr_permanent_delete BEFORE DELETE ON public.purchase_requests FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_permanent_delete();
CREATE TRIGGER guard_rfq_permanent_delete BEFORE DELETE ON public.rfqs FOR EACH ROW EXECUTE FUNCTION public.guard_procurement_permanent_delete();