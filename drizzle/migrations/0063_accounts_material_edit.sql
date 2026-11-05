-- 0063: Grant Accounts staff add/edit access to the Materials master only.
-- Does not grant category/unit administration, stock movements, or deletion.
INSERT INTO public.permissions(code,module,description,sort_order)
VALUES ('materials.view','Inventory','View materials, categories and units',82)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions(code,module,description,sort_order)
VALUES ('materials.edit','Inventory','Create and edit material records, without deletion, stock operations, or category/unit administration',84)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions(role,permission_code)
VALUES ('accountant','materials.view'),
       ('accountant','materials.edit'),
       ('accounts_manager','materials.view'),
       ('accounts_manager','materials.edit')
ON CONFLICT DO NOTHING;

-- Preserve existing material managers' rights and add narrower editing rights.
DROP POLICY IF EXISTS "Material managers create materials" ON public.items;
CREATE POLICY "Material managers create materials" ON public.items
FOR INSERT TO authenticated
WITH CHECK (
  (public.has_permission(auth.uid(),'materials.manage') OR
   public.has_permission(auth.uid(),'materials.edit'))
  AND public.actor_in_company(company_id)
);

DROP POLICY IF EXISTS "Material managers update materials" ON public.items;
CREATE POLICY "Material managers update materials" ON public.items
FOR UPDATE TO authenticated
USING (
  (public.has_permission(auth.uid(),'materials.manage') OR
   public.has_permission(auth.uid(),'materials.edit'))
  AND public.actor_in_company(company_id)
)
WITH CHECK (
  (public.has_permission(auth.uid(),'materials.manage') OR
   public.has_permission(auth.uid(),'materials.edit'))
  AND public.actor_in_company(company_id)
);

-- Intentionally DO NOT alter the DELETE policy, currently requiring
-- 'materials.manage', or the permissions governing category/unit and inventory.
