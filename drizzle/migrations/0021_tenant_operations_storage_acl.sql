-- Staging-first migration 0021: tenant isolation on operational data.
-- Requires migrations 0019 (viewer) and 0020 (actor_in_company).
-- Existing business rows are not deleted. The only permission change is to
-- limit the legacy 'auditor' role to the intended Management Viewer rights.

-- Audit the previously accumulated Auditor role grants: RFQ, quotations,
-- purchasing and general-ledger details were never meant for the boss's
-- read-only material/expense dashboard. Drop rights NOT explicitly approved.
DELETE FROM public.role_permissions
WHERE role='auditor' AND permission_code NOT IN (
  'company.view','projects.view_all','warehouses.view','materials.view',
  'vendors.view','inventory.view','financial.view','reports.view',
  'purchase_order.view','vendor_invoice.view','payable.view','payment.view'
);

-- Every company-owned vendor/material master query and modification must be
-- constrained by the currently authenticated actor's company.

DROP POLICY IF EXISTS "Active staff view vendor categories" ON public.vendor_categories;
CREATE POLICY "Active staff view vendor categories" ON public.vendor_categories FOR SELECT TO authenticated
USING (public.is_active_user(auth.uid()) AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Vendor managers manage categories" ON public.vendor_categories;
CREATE POLICY "Vendor managers manage categories" ON public.vendor_categories FOR ALL TO authenticated
USING (public.has_permission(auth.uid(),'vendors.manage') AND public.actor_in_company(company_id))
WITH CHECK (public.has_permission(auth.uid(),'vendors.manage') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Authorized staff view vendors" ON public.vendors;
CREATE POLICY "Authorized staff view vendors" ON public.vendors FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'vendors.view') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Vendor managers create vendors" ON public.vendors;
CREATE POLICY "Vendor managers create vendors" ON public.vendors FOR INSERT TO authenticated
WITH CHECK (public.has_permission(auth.uid(),'vendors.manage') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Vendor managers update vendors" ON public.vendors;
CREATE POLICY "Vendor managers update vendors" ON public.vendors FOR UPDATE TO authenticated
USING (public.has_permission(auth.uid(),'vendors.manage') AND public.actor_in_company(company_id))
WITH CHECK (public.has_permission(auth.uid(),'vendors.manage') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Vendor managers delete vendors" ON public.vendors;
CREATE POLICY "Vendor managers delete vendors" ON public.vendors FOR DELETE TO authenticated
USING (public.has_permission(auth.uid(),'vendors.manage') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Authorized staff view units of measure" ON public.units_of_measure;
CREATE POLICY "Authorized staff view units of measure" ON public.units_of_measure FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'materials.view') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Material managers manage units of measure" ON public.units_of_measure;
CREATE POLICY "Material managers manage units of measure" ON public.units_of_measure FOR ALL TO authenticated
USING (public.has_permission(auth.uid(),'materials.manage') AND public.actor_in_company(company_id))
WITH CHECK (public.has_permission(auth.uid(),'materials.manage') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Authorized staff view item categories" ON public.item_categories;
CREATE POLICY "Authorized staff view item categories" ON public.item_categories FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'materials.view') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Material managers manage categories" ON public.item_categories;
CREATE POLICY "Material managers manage categories" ON public.item_categories FOR ALL TO authenticated
USING (public.has_permission(auth.uid(),'materials.manage') AND public.actor_in_company(company_id))
WITH CHECK (public.has_permission(auth.uid(),'materials.manage') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Authorized staff view materials" ON public.items;
CREATE POLICY "Authorized staff view materials" ON public.items FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'materials.view') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Material managers create materials" ON public.items;
CREATE POLICY "Material managers create materials" ON public.items FOR INSERT TO authenticated
WITH CHECK (public.has_permission(auth.uid(),'materials.manage') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Material managers update materials" ON public.items;
CREATE POLICY "Material managers update materials" ON public.items FOR UPDATE TO authenticated
USING (public.has_permission(auth.uid(),'materials.manage') AND public.actor_in_company(company_id))
WITH CHECK (public.has_permission(auth.uid(),'materials.manage') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Material managers delete materials" ON public.items;
CREATE POLICY "Material managers delete materials" ON public.items FOR DELETE TO authenticated
USING (public.has_permission(auth.uid(),'materials.manage') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "Authorized staff view vendor classifications" ON public.vendor_category_links;
CREATE POLICY "Authorized staff view vendor classifications" ON public.vendor_category_links FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'vendors.view') AND EXISTS (
  SELECT 1 FROM public.vendors v
  JOIN public.vendor_categories category ON category.id=vendor_category_links.category_id
  WHERE v.id=vendor_category_links.vendor_id
    AND v.company_id=category.company_id
    AND public.actor_in_company(v.company_id)
));

DROP POLICY IF EXISTS "Vendor managers manage classifications" ON public.vendor_category_links;
CREATE POLICY "Vendor managers manage classifications" ON public.vendor_category_links FOR ALL TO authenticated
USING (public.has_permission(auth.uid(),'vendors.manage') AND EXISTS (
  SELECT 1 FROM public.vendors v
  JOIN public.vendor_categories category ON category.id=vendor_category_links.category_id
  WHERE v.id=vendor_category_links.vendor_id
    AND v.company_id=category.company_id
    AND public.actor_in_company(v.company_id)
))
WITH CHECK (public.has_permission(auth.uid(),'vendors.manage') AND EXISTS (
  SELECT 1 FROM public.vendors v
  JOIN public.vendor_categories category ON category.id=vendor_category_links.category_id
  WHERE v.id=vendor_category_links.vendor_id
    AND v.company_id=category.company_id
    AND public.actor_in_company(v.company_id)
));

DROP POLICY IF EXISTS "Authorized staff view warehouses" ON public.warehouses;
CREATE POLICY "Authorized staff view warehouses" ON public.warehouses FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'warehouses.view') AND public.actor_in_company(company_id)
  AND (project_id IS NULL OR public.can_access_project(auth.uid(),project_id)));

DROP POLICY IF EXISTS "Warehouse managers create warehouses" ON public.warehouses;
CREATE POLICY "Warehouse managers create warehouses" ON public.warehouses FOR INSERT TO authenticated
WITH CHECK (public.has_permission(auth.uid(),'warehouses.manage') AND public.actor_in_company(company_id)
  AND (project_id IS NULL OR public.can_access_project(auth.uid(),project_id)));

DROP POLICY IF EXISTS "Warehouse managers update warehouses" ON public.warehouses;
CREATE POLICY "Warehouse managers update warehouses" ON public.warehouses FOR UPDATE TO authenticated
USING (public.has_permission(auth.uid(),'warehouses.manage') AND public.actor_in_company(company_id)
  AND (project_id IS NULL OR public.can_access_project(auth.uid(),project_id)))
WITH CHECK (public.has_permission(auth.uid(),'warehouses.manage') AND public.actor_in_company(company_id)
  AND (project_id IS NULL OR public.can_access_project(auth.uid(),project_id)));

DROP POLICY IF EXISTS "Warehouse managers delete warehouses" ON public.warehouses;
CREATE POLICY "Warehouse managers delete warehouses" ON public.warehouses FOR DELETE TO authenticated
USING (public.has_permission(auth.uid(),'warehouses.manage') AND public.actor_in_company(company_id)
  AND (project_id IS NULL OR public.can_access_project(auth.uid(),project_id)));

DROP POLICY IF EXISTS "View transfers" ON public.stock_transfers;
CREATE POLICY "View transfers" ON public.stock_transfers FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'inventory.view')
  AND public.actor_in_company(company_id)
  AND EXISTS (
    SELECT 1 FROM public.warehouses source WHERE source.id=stock_transfers.from_warehouse_id
      AND public.actor_in_company(source.company_id)
      AND (source.project_id IS NULL OR public.can_access_project(auth.uid(),source.project_id))
  )
  AND EXISTS (
    SELECT 1 FROM public.warehouses destination WHERE destination.id=stock_transfers.to_warehouse_id
      AND public.actor_in_company(destination.company_id)
      AND (destination.project_id IS NULL OR public.can_access_project(auth.uid(),destination.project_id))
  ));

DROP POLICY IF EXISTS "View transfer items" ON public.stock_transfer_items;
CREATE POLICY "View transfer items" ON public.stock_transfer_items FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'inventory.view') AND EXISTS (
  SELECT 1 FROM public.stock_transfers t
  WHERE t.id=stock_transfer_items.transfer_id AND public.actor_in_company(t.company_id)
));

DROP POLICY IF EXISTS "View payments" ON public.vendor_payments;
CREATE POLICY "View payments" ON public.vendor_payments FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'payment.view') AND public.actor_in_company(company_id)
  AND (project_id IS NULL OR public.can_access_project(auth.uid(),project_id)));

DROP POLICY IF EXISTS "View allocations" ON public.vendor_payment_allocations;
CREATE POLICY "View allocations" ON public.vendor_payment_allocations FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'payment.view') AND EXISTS (
    SELECT 1 FROM public.vendor_payments payment
    WHERE payment.id=vendor_payment_allocations.payment_id
      AND public.actor_in_company(payment.company_id)
      AND (payment.project_id IS NULL OR public.can_access_project(auth.uid(),payment.project_id))
  ));

DROP POLICY IF EXISTS "View advance adjustments" ON public.vendor_advance_adjustments;
CREATE POLICY "View advance adjustments" ON public.vendor_advance_adjustments FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'payment.view') AND EXISTS (
    SELECT 1 FROM public.vendor_payments payment
    WHERE payment.id=vendor_advance_adjustments.advance_payment_id
      AND public.actor_in_company(payment.company_id)
      AND (payment.project_id IS NULL OR public.can_access_project(auth.uid(),payment.project_id))
  ));

DROP POLICY IF EXISTS "View payment events" ON public.vendor_payment_events;
CREATE POLICY "View payment events" ON public.vendor_payment_events FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'payment.view') AND EXISTS (
    SELECT 1 FROM public.vendor_payments payment
    WHERE payment.id=vendor_payment_events.payment_id
      AND public.actor_in_company(payment.company_id)
      AND (payment.project_id IS NULL OR public.can_access_project(auth.uid(),payment.project_id))
  ));

DROP POLICY IF EXISTS "Ledger viewers read accounts" ON public.accounts;
CREATE POLICY "Ledger viewers read accounts" ON public.accounts FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'ledger.view') AND public.actor_in_company(company_id));

DROP POLICY IF EXISTS "View journals" ON public.journal_entries;
CREATE POLICY "View journals" ON public.journal_entries FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'ledger.view') AND public.actor_in_company(company_id)
  AND (project_id IS NULL OR public.can_access_project(auth.uid(),project_id)));

DROP POLICY IF EXISTS "View journal lines" ON public.journal_lines;
CREATE POLICY "View journal lines" ON public.journal_lines FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'ledger.view') AND EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.id=journal_lines.entry_id AND public.actor_in_company(e.company_id)
      AND (e.project_id IS NULL OR public.can_access_project(auth.uid(),e.project_id))
  ));


-- Audit logs have no company_id column in legacy schema. Fail closed for
-- system events without an attributable user; never show other companies'
-- historical old_data/new_data. SECDEF avoids recursive profile-RLS lookups.
CREATE OR REPLACE FUNCTION public.can_view_company_audit(_origin uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles me JOIN public.profiles origin
      ON origin.id=_origin AND origin.company_id=me.company_id
    WHERE me.id=auth.uid() AND me.is_active
  )
$$;
REVOKE ALL ON FUNCTION public.can_view_company_audit(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_company_audit(uuid) TO authenticated;

DROP POLICY IF EXISTS "Auditors view logs" ON public.audit_logs;
CREATE POLICY "Auditors view logs" ON public.audit_logs FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'audit.view') AND public.can_view_company_audit(user_id));

-- A signed storage URL must not be issued merely because someone has
-- payment.view: the attachment must be linked to a document they can view
-- in their company and (where relevant) assigned project.
DROP POLICY IF EXISTS "Finance read vendor documents" ON storage.objects;
CREATE POLICY "Finance read vendor documents" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='vendor-documents' AND (
    (public.has_permission(auth.uid(),'vendor_invoice.view') AND EXISTS (
      SELECT 1 FROM public.vendor_invoices invoice
      WHERE invoice.attachment_path=storage.objects.name
        AND public.actor_in_company(invoice.company_id)
        AND public.can_access_project(auth.uid(),invoice.project_id)
    ))
    OR (public.has_permission(auth.uid(),'payment.view') AND EXISTS (
      SELECT 1 FROM public.vendor_payments payment
      WHERE payment.proof_path=storage.objects.name
        AND public.actor_in_company(payment.company_id)
        AND (payment.project_id IS NULL OR public.can_access_project(auth.uid(),payment.project_id))
    ))
  )
);
