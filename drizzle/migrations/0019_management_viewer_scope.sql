-- Source-only migration. Apply to a backed-up database after review.
-- An existing "auditor" role becomes KK GROUP's management read-only viewer.
-- All granted capabilities below are VIEW-only; do NOT grant any mutation.
INSERT INTO public.permissions(code,module,description,sort_order)
VALUES ('financial.view','Reports','View management financial summaries without write access',135)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions(role,permission_code)
SELECT 'auditor'::public.app_role, p.code
FROM public.permissions p
WHERE p.code IN (
  'company.view','projects.view_all','warehouses.view','materials.view',
  'vendors.view','inventory.view','financial.view','reports.view',
  'purchase_order.view','vendor_invoice.view','payable.view','payment.view'
)
ON CONFLICT (role,permission_code) DO NOTHING;

-- Warehouse stock previously checked inventory.view without company scope.
-- Prevent a viewer from reading stock belonging to another company.
DROP POLICY IF EXISTS "View stock" ON public.warehouse_stock;
CREATE POLICY "View stock" ON public.warehouse_stock FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(),'inventory.view')
  AND EXISTS (
    SELECT 1 FROM public.warehouses w
    JOIN public.profiles actor ON actor.id=auth.uid()
    WHERE w.id=warehouse_stock.warehouse_id
      AND actor.is_active AND w.company_id=actor.company_id
      AND (w.project_id IS NULL OR public.can_access_project(auth.uid(),w.project_id))
  )
);

DROP POLICY IF EXISTS "View stock ledger" ON public.inventory_transactions;
CREATE POLICY "View stock ledger" ON public.inventory_transactions FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(),'inventory.view')
  AND EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.id=auth.uid() AND actor.is_active AND actor.company_id=inventory_transactions.company_id
  )
  AND (inventory_transactions.project_id IS NULL
       OR public.can_access_project(auth.uid(),inventory_transactions.project_id))
);
