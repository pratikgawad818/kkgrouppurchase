CREATE OR REPLACE FUNCTION public.guard_procurement_permanent_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 -- Save receipts are immutable retry identifiers, not business children. Retain them after draft deletion.
 RETURN OLD;
END $$;
CREATE OR REPLACE FUNCTION public.check_staff_deletion_history(_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'super_admin') OR NOT EXISTS(SELECT 1 FROM public.profiles a JOIN public.profiles t ON t.company_id=a.company_id WHERE a.id=auth.uid() AND a.is_active AND t.id=_id) THEN RAISE EXCEPTION 'Only an active company Super Admin can permanently delete staff.'; END IF;
 IF EXISTS(SELECT 1 FROM public.unit_status_history WHERE changed_by=_id) OR EXISTS(SELECT 1 FROM public.audit_logs WHERE user_id=_id) THEN RAISE EXCEPTION 'This staff account has recorded history and cannot be permanently deleted.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.check_staff_deletion_history(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.check_staff_deletion_history(uuid) TO authenticated;