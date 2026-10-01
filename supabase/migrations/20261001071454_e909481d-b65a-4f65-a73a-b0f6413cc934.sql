REVOKE EXECUTE ON FUNCTION public.has_role, public.has_permission, public.is_active_user, public.can_access_project,
  public.my_permissions, public.set_unit_status, public.ensure_profile, public.generate_units FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.audit_row(), public.units_status_history(), public.units_before_write(), public.touch_updated_at() FROM PUBLIC, anon, authenticated;