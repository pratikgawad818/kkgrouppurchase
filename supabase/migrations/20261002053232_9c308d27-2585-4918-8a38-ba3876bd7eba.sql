DROP POLICY "Everyone reads permissions" ON public.permissions;
DROP POLICY "Everyone reads role matrix" ON public.role_permissions;

CREATE POLICY "Admins read permissions"
ON public.permissions FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(), 'users.manage'));

CREATE POLICY "Admins read role matrix"
ON public.role_permissions FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(), 'users.manage'));