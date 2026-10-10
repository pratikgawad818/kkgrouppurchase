-- REVIEW/STAGING-ONLY: company and project authorization hardening.
-- Apply after 0019 with a verified backup and authenticated RLS acceptance.
-- No historical staff/project/company data is deleted or rewritten.

CREATE OR REPLACE FUNCTION public.actor_in_company(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.id=auth.uid() AND actor.is_active
      AND actor.company_id=_company_id
  )
$$;
REVOKE ALL ON FUNCTION public.actor_in_company(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actor_in_company(uuid) TO authenticated;

-- Earlier projects.view_all meant ALL companies, not all projects of the
-- signed-in actor's company. SECDEF is important to avoid recursive project RLS.
CREATE OR REPLACE FUNCTION public.can_access_project(_user_id uuid, _project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects project
    JOIN public.profiles actor ON actor.id=_user_id
    WHERE project.id=_project_id AND actor.is_active
      AND actor.company_id=project.company_id
      AND (
        public.has_permission(_user_id,'projects.view_all')
        OR EXISTS (
          SELECT 1 FROM public.user_project_assignments assignment
          WHERE assignment.user_id=_user_id
            AND assignment.project_id=project.id
        )
      )
  )
$$;

DROP POLICY IF EXISTS "Active staff view company" ON public.companies;
CREATE POLICY "Active staff view company" ON public.companies
FOR SELECT TO authenticated USING (public.actor_in_company(id));

DROP POLICY IF EXISTS "Managers update company" ON public.companies;
CREATE POLICY "Managers update company" ON public.companies
FOR UPDATE TO authenticated
USING (public.actor_in_company(id) AND public.has_permission(auth.uid(),'company.manage'))
WITH CHECK (public.actor_in_company(id) AND public.has_permission(auth.uid(),'company.manage'));

DROP POLICY IF EXISTS "View bank accounts" ON public.company_bank_accounts;
CREATE POLICY "View bank accounts" ON public.company_bank_accounts
FOR SELECT TO authenticated
USING (public.actor_in_company(company_id) AND
  (public.has_permission(auth.uid(),'company.bank.view') OR public.has_permission(auth.uid(),'company.manage')));

DROP POLICY IF EXISTS "Manage bank accounts" ON public.company_bank_accounts;
CREATE POLICY "Manage bank accounts" ON public.company_bank_accounts
FOR ALL TO authenticated
USING (public.actor_in_company(company_id) AND public.has_permission(auth.uid(),'company.manage'))
WITH CHECK (public.actor_in_company(company_id) AND public.has_permission(auth.uid(),'company.manage'));

DROP POLICY IF EXISTS "Active staff view periods" ON public.financial_periods;
CREATE POLICY "Active staff view periods" ON public.financial_periods
FOR SELECT TO authenticated USING (public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Manage periods" ON public.financial_periods;
CREATE POLICY "Manage periods" ON public.financial_periods
FOR ALL TO authenticated
USING (public.actor_in_company(company_id) AND public.has_permission(auth.uid(),'company.manage'))
WITH CHECK (public.actor_in_company(company_id) AND public.has_permission(auth.uid(),'company.manage'));

DROP POLICY IF EXISTS "View own or staff profiles" ON public.profiles;
CREATE POLICY "View own or staff profiles" ON public.profiles
FOR SELECT TO authenticated
USING (
  id=auth.uid()
  OR (
    public.actor_in_company(company_id)
    AND (public.has_permission(auth.uid(),'users.manage')
      OR public.has_permission(auth.uid(),'projects.manage'))
  )
);

DROP POLICY IF EXISTS "User admins update profiles" ON public.profiles;
CREATE POLICY "User admins update profiles" ON public.profiles
FOR UPDATE TO authenticated
USING (public.actor_in_company(company_id) AND public.has_permission(auth.uid(),'users.manage'))
WITH CHECK (public.actor_in_company(company_id) AND public.has_permission(auth.uid(),'users.manage'));

DROP POLICY IF EXISTS "View own or all roles" ON public.user_roles;
CREATE POLICY "View own or all roles" ON public.user_roles
FOR SELECT TO authenticated
USING (
  user_id=auth.uid()
  OR (
    public.has_permission(auth.uid(),'users.manage')
    AND EXISTS (
      SELECT 1 FROM public.profiles target
      WHERE target.id=user_roles.user_id
        AND public.actor_in_company(target.company_id)
    )
  )
);

DROP POLICY IF EXISTS "Grant roles" ON public.user_roles;
CREATE POLICY "Grant roles" ON public.user_roles
FOR INSERT TO authenticated
WITH CHECK (
  role <> 'super_admin'
  AND public.has_permission(auth.uid(),'users.manage')
  AND EXISTS (
    SELECT 1 FROM public.profiles target
    WHERE target.id=user_roles.user_id AND public.actor_in_company(target.company_id)
  )
);

DROP POLICY IF EXISTS "Revoke roles" ON public.user_roles;
CREATE POLICY "Revoke roles" ON public.user_roles
FOR DELETE TO authenticated
USING (
  role <> 'super_admin'
  AND public.has_permission(auth.uid(),'users.manage')
  AND EXISTS (
    SELECT 1 FROM public.profiles target
    WHERE target.id=user_roles.user_id AND public.actor_in_company(target.company_id)
  )
);

DROP POLICY IF EXISTS "Create projects" ON public.projects;
CREATE POLICY "Create projects" ON public.projects
FOR INSERT TO authenticated WITH CHECK (
  public.has_permission(auth.uid(),'projects.manage')
  AND public.actor_in_company(company_id)
);

DROP POLICY IF EXISTS "Update projects" ON public.projects;
CREATE POLICY "Update projects" ON public.projects
FOR UPDATE TO authenticated
USING (public.has_permission(auth.uid(),'projects.manage') AND public.actor_in_company(company_id))
WITH CHECK (public.has_permission(auth.uid(),'projects.manage') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Super admin deletes empty projects" ON public.projects;
CREATE POLICY "Super admin deletes empty projects" ON public.projects
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'super_admin') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "View assignments" ON public.user_project_assignments;
CREATE POLICY "View assignments" ON public.user_project_assignments
FOR SELECT TO authenticated USING (
  public.can_access_project(auth.uid(),project_id)
  AND EXISTS (
    SELECT 1 FROM public.profiles assignee JOIN public.projects project
      ON project.id=user_project_assignments.project_id
    WHERE assignee.id=user_project_assignments.user_id
      AND assignee.company_id=project.company_id
  )
  AND (
    user_id=auth.uid()
    OR public.has_permission(auth.uid(),'users.manage')
    OR public.has_permission(auth.uid(),'projects.manage')
  )
);

DROP POLICY IF EXISTS "Manage assignments" ON public.user_project_assignments;
CREATE POLICY "Manage assignments" ON public.user_project_assignments
FOR ALL TO authenticated
USING (
  (public.has_permission(auth.uid(),'users.manage') OR public.has_permission(auth.uid(),'projects.manage'))
  AND public.can_access_project(auth.uid(),project_id)
  AND EXISTS (
    SELECT 1 FROM public.profiles assignee JOIN public.projects project
      ON project.id=user_project_assignments.project_id
    WHERE assignee.id=user_project_assignments.user_id
      AND assignee.company_id=project.company_id
  )
)
WITH CHECK (
  (public.has_permission(auth.uid(),'users.manage') OR public.has_permission(auth.uid(),'projects.manage'))
  AND public.can_access_project(auth.uid(),project_id)
  AND EXISTS (
    SELECT 1 FROM public.profiles assignee JOIN public.projects project
      ON project.id=user_project_assignments.project_id
    WHERE assignee.id=user_project_assignments.user_id
      AND assignee.company_id=project.company_id
  )
);
