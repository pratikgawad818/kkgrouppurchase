-- 0099 SECURITY: Enforce current project access on every PR read/write path.
-- Earlier 0090 fixed "View PRs" SELECT and 0092 fixed the privileged
-- state-transition function. This closes adjacent draft UPDATE/DELETE and
-- draft-item mutation policies; no business records are modified.
--
-- PostgreSQL combines permissive RLS policies with OR, so each existing
-- write policy must itself respect assignment revocation.

DROP POLICY IF EXISTS "Create PRs" ON public.purchase_requests;
CREATE POLICY "Create PRs" ON public.purchase_requests
 FOR INSERT TO authenticated
 WITH CHECK (
   requested_by=auth.uid()
   AND public.has_permission(auth.uid(),'purchase_request.create')
   AND public.actor_in_company(company_id)
   AND public.can_access_project(auth.uid(),project_id)
   AND EXISTS (
     SELECT 1 FROM public.projects pr
     WHERE pr.id=project_id AND pr.company_id=purchase_requests.company_id
   )
 );

DROP POLICY IF EXISTS "Edit own draft PRs" ON public.purchase_requests;
CREATE POLICY "Edit own draft PRs" ON public.purchase_requests
 FOR UPDATE TO authenticated
 USING (
   status='draft'::public.pr_status
   AND requested_by=auth.uid()
   AND public.has_permission(auth.uid(),'purchase_request.edit')
   AND public.actor_in_company(company_id)
   AND public.can_access_project(auth.uid(),project_id)
 )
 WITH CHECK (
   status='draft'::public.pr_status
   AND requested_by=auth.uid()
   AND public.has_permission(auth.uid(),'purchase_request.edit')
   AND public.actor_in_company(company_id)
   AND public.can_access_project(auth.uid(),project_id)
   AND EXISTS(
      SELECT 1 FROM public.projects pr
      WHERE pr.id=project_id AND pr.company_id=purchase_requests.company_id
   )
 );

DROP POLICY IF EXISTS "Delete own draft PRs" ON public.purchase_requests;
CREATE POLICY "Delete own draft PRs" ON public.purchase_requests
 FOR DELETE TO authenticated
 USING (
   status='draft'::public.pr_status
   AND requested_by=auth.uid()
   AND public.actor_in_company(company_id)
   AND public.can_access_project(auth.uid(),project_id)
   AND NOT EXISTS (
     SELECT 1 FROM public.purchase_request_approvals a
     WHERE a.purchase_request_id=purchase_requests.id
       AND a.action<>'created'::public.pr_action
   )
 );

-- The previous FOR ALL policy granted SELECT in addition to writing. Retain
-- existing draft-item behavior, but require current company/project assignment
-- for both the old and new item-parent relation.
DROP POLICY IF EXISTS "Write draft PR items" ON public.purchase_request_items;
CREATE POLICY "Write draft PR items" ON public.purchase_request_items
 FOR ALL TO authenticated
 USING (
   EXISTS (
     SELECT 1 FROM public.purchase_requests pr
     WHERE pr.id=purchase_request_items.purchase_request_id
       AND pr.status='draft'::public.pr_status
       AND pr.requested_by=auth.uid()
       AND public.actor_in_company(pr.company_id)
       AND public.can_access_project(auth.uid(),pr.project_id)
   )
 )
 WITH CHECK (
   EXISTS (
     SELECT 1 FROM public.purchase_requests pr
     WHERE pr.id=purchase_request_items.purchase_request_id
       AND pr.status='draft'::public.pr_status
       AND pr.requested_by=auth.uid()
       AND public.actor_in_company(pr.company_id)
       AND public.can_access_project(auth.uid(),pr.project_id)
   )
 );
