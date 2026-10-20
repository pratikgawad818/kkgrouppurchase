CREATE OR REPLACE FUNCTION public.audit_immutable()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
 IF TG_OP='DELETE' AND current_setting('app.force_delete',true)='on' THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Audit history is permanent and cannot be changed or deleted';
END $function$;

CREATE OR REPLACE FUNCTION public.super_admin_clear_history(_scope text, _audit_id bigint DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid; _n integer := 0; _c integer;
BEGIN
  IF NOT (public.has_role(auth.uid(),'super_admin') AND public.is_active_user(auth.uid())) THEN
    RAISE EXCEPTION 'Only an active Super Admin can clear history';
  END IF;
  SELECT company_id INTO _company FROM profiles WHERE id = auth.uid();
  PERFORM set_config('app.force_delete','on',true);
  IF _scope IN ('approvals','all') THEN
    DELETE FROM director_approval_votes v WHERE v.actor_id IN (SELECT id FROM profiles WHERE company_id=_company); GET DIAGNOSTICS _c = ROW_COUNT; _n := _n+_c;
    DELETE FROM approval_reminder_events; GET DIAGNOSTICS _c = ROW_COUNT; _n := _n+_c;
    DELETE FROM purchase_order_approvals a USING purchase_orders p WHERE p.id=a.po_id AND p.company_id=_company; GET DIAGNOSTICS _c = ROW_COUNT; _n := _n+_c;
    DELETE FROM notifications n WHERE n.user_id IN (SELECT id FROM profiles WHERE company_id=_company)
      AND (n.link LIKE '/approvals%' OR n.title ILIKE '%approv%'); GET DIAGNOSTICS _c = ROW_COUNT; _n := _n+_c;
  END IF;
  IF _scope IN ('audit','all') THEN
    DELETE FROM audit_logs l WHERE (l.user_id IS NULL OR l.user_id IN (SELECT id FROM profiles WHERE company_id=_company)); GET DIAGNOSTICS _c = ROW_COUNT; _n := _n+_c;
  END IF;
  IF _scope = 'audit_row' THEN
    DELETE FROM audit_logs l WHERE l.id=_audit_id AND (l.user_id IS NULL OR l.user_id IN (SELECT id FROM profiles WHERE company_id=_company)); GET DIAGNOSTICS _n = ROW_COUNT;
  END IF;
  PERFORM set_config('app.force_delete','off',true);
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.super_admin_clear_history(text,bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.super_admin_clear_history(text,bigint) TO authenticated;