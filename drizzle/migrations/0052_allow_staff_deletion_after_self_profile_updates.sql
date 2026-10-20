CREATE OR REPLACE FUNCTION public.staff_audit_blocks_deletion(_entity text, _action text, _entity_id text, _user_id uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
 SELECT NOT coalesce(
   (_entity = 'profiles' AND _action IN ('insert','update') AND _entity_id = _user_id::text)
   OR (_entity IN ('auth','sessions') AND _action IN ('login','logout','signed_in','signed_out') AND _entity_id = _user_id::text),
   false
 );
$$;
REVOKE ALL ON FUNCTION public.staff_audit_blocks_deletion(text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_audit_blocks_deletion(text,text,text,uuid) TO service_role;
COMMENT ON FUNCTION public.staff_audit_blocks_deletion(text,text,text,uuid) IS 'Ignore only self-profile creation/updates and own sign-in activity when checking staff deletion. Preserve all audit rows; all other events block deletion.';

CREATE OR REPLACE FUNCTION public.check_staff_deletion_history(_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'super_admin') OR NOT EXISTS(SELECT 1 FROM public.profiles a JOIN public.profiles t ON t.company_id=a.company_id WHERE a.id=auth.uid() AND a.is_active AND t.id=_id) THEN RAISE EXCEPTION 'Only an active company Super Admin can permanently delete staff.'; END IF;
 IF _id=auth.uid() OR public.has_role(_id,'super_admin') THEN RAISE EXCEPTION 'Your own account and Super Admin accounts cannot be deleted.'; END IF;
 IF EXISTS(SELECT 1 FROM public.unit_status_history WHERE changed_by=_id) OR EXISTS(SELECT 1 FROM public.audit_logs WHERE user_id=_id AND public.staff_audit_blocks_deletion(entity,action,entity_id,user_id)) THEN RAISE EXCEPTION 'This staff account has business or approval history and cannot be permanently deleted.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.check_staff_deletion_history(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.check_staff_deletion_history(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_staff_permanent_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Staff accounts must be deleted through the protected account deletion action.'; END IF;
 IF EXISTS(SELECT 1 FROM public.unit_status_history WHERE changed_by=OLD.id) OR EXISTS(SELECT 1 FROM public.audit_logs WHERE user_id=OLD.id AND public.staff_audit_blocks_deletion(entity,action,entity_id,user_id)) THEN RAISE EXCEPTION 'This staff account has business or approval history and cannot be permanently deleted.'; END IF;
 RETURN OLD;
END $$;