-- Post-0020 disposal fixture: recreate the operational tables/policies relevant
-- to the original broad-permission information disclosure risks.
CREATE SCHEMA storage;
CREATE FUNCTION public.is_active_user(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=_uid AND is_active)
$;
CREATE TABLE public.role_permissions (role text NOT NULL, permission_code text NOT NULL, PRIMARY KEY(role,permission_code));
CREATE OR REPLACE FUNCTION public.has_permission(_uid uuid,_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles roles JOIN public.profiles actor ON actor.id=roles.user_id
    JOIN public.role_permissions granted ON granted.role=roles.role
    WHERE roles.user_id=_uid AND actor.is_active AND granted.permission_code=_code
  )
$$;
INSERT INTO role_permissions(role,permission_code)
SELECT 'company_admin',unnest(ARRAY[
 'users.manage','projects.manage','projects.view_all','company.manage',
 'company.bank.view','vendor_invoice.view','payment.view','inventory.view',
 'materials.view','materials.manage','vendors.view','vendors.manage',
 'warehouses.view','warehouses.manage','ledger.view','audit.view'
]);
INSERT INTO role_permissions(role,permission_code)
SELECT 'auditor',unnest(ARRAY[
 'company.view','projects.view_all','warehouses.view','materials.view',
 'vendors.view','inventory.view','financial.view','reports.view',
 'purchase_order.view','vendor_invoice.view','payable.view','payment.view',
 'ledger.view','rfq.view','quotation.view','quotation.compare','purchase_request.view'
]);
INSERT INTO role_permissions VALUES
 ('store_manager','inventory.view'),('store_manager','warehouses.view');

CREATE TABLE public.vendor_categories (id uuid PRIMARY KEY,company_id uuid NOT NULL,name text);
CREATE TABLE public.vendors (id uuid PRIMARY KEY,company_id uuid NOT NULL,company_name text);
CREATE TABLE public.vendor_category_links (vendor_id uuid,category_id uuid);
CREATE TABLE public.units_of_measure (id uuid PRIMARY KEY,company_id uuid NOT NULL,code text);
CREATE TABLE public.item_categories (id uuid PRIMARY KEY,company_id uuid NOT NULL,name text);
CREATE TABLE public.items (id uuid PRIMARY KEY,company_id uuid NOT NULL,name text);
CREATE TABLE public.warehouses (id uuid PRIMARY KEY,company_id uuid NOT NULL,project_id uuid,name text);
CREATE TABLE public.stock_transfers (id uuid PRIMARY KEY,company_id uuid NOT NULL,from_warehouse_id uuid,to_warehouse_id uuid);
CREATE TABLE public.stock_transfer_items (id uuid PRIMARY KEY,transfer_id uuid);
CREATE TABLE public.vendor_payments (id uuid PRIMARY KEY,company_id uuid NOT NULL,project_id uuid,proof_path text);
CREATE TABLE public.vendor_payment_allocations (id uuid PRIMARY KEY,payment_id uuid);
CREATE TABLE public.vendor_advance_adjustments (id uuid PRIMARY KEY,advance_payment_id uuid);
CREATE TABLE public.vendor_payment_events (id uuid PRIMARY KEY,payment_id uuid);
CREATE TABLE public.vendor_invoices (id uuid PRIMARY KEY,company_id uuid NOT NULL,project_id uuid NOT NULL,attachment_path text);
CREATE TABLE public.accounts (id uuid PRIMARY KEY,company_id uuid NOT NULL,name text);
CREATE TABLE public.journal_entries (id uuid PRIMARY KEY,company_id uuid NOT NULL,project_id uuid);
CREATE TABLE public.journal_lines (id uuid PRIMARY KEY,entry_id uuid);
CREATE TABLE public.audit_logs (id uuid PRIMARY KEY,user_id uuid,old_data jsonb,new_data jsonb);
CREATE TABLE storage.objects (id uuid PRIMARY KEY,bucket_id text NOT NULL,name text NOT NULL);

DO $qa_rls_setup$ DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY[
    'vendor_categories','vendors','vendor_category_links','units_of_measure',
    'item_categories','items','warehouses','stock_transfers','stock_transfer_items',
    'vendor_payments','vendor_payment_allocations','vendor_advance_adjustments',
    'vendor_payment_events','vendor_invoices','accounts','journal_entries',
    'journal_lines','audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  END LOOP;
END $qa_rls_setup$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT,INSERT ON storage.objects TO authenticated;

-- In this disposal fixture the vendor invoices use the existing project RLS.
CREATE POLICY "View invoices" ON public.vendor_invoices FOR SELECT TO authenticated
USING (public.has_permission(auth.uid(),'vendor_invoice.view')
   AND public.can_access_project(auth.uid(),project_id));

INSERT INTO vendor_categories VALUES
 ('50000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Cement'),
 ('50000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Steel');
INSERT INTO vendors VALUES
 ('51000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Supplier A'),
 ('51000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Supplier B');
INSERT INTO vendor_category_links VALUES
 ('51000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001'),
 ('51000000-0000-4000-8000-000000000011','50000000-0000-4000-8000-000000000011');
INSERT INTO units_of_measure VALUES
 ('52000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','BAG'),
 ('52000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','KG');
INSERT INTO item_categories VALUES
 ('53000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Cement'),
 ('53000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Steel');
INSERT INTO items VALUES
 ('54000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','OPC 53'),
 ('54000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','TMT 12');
INSERT INTO warehouses VALUES
 ('55000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',NULL,'A central'),
 ('55000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','20000000-0000-4000-8000-000000000001','A project'),
 ('55000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',NULL,'B central');
INSERT INTO stock_transfers VALUES
 ('56000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
   '55000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000002'),
 ('56000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
   '55000000-0000-4000-8000-000000000011','55000000-0000-4000-8000-000000000011');
INSERT INTO stock_transfer_items VALUES
 ('57000000-0000-4000-8000-000000000001','56000000-0000-4000-8000-000000000001'),
 ('57000000-0000-4000-8000-000000000011','56000000-0000-4000-8000-000000000011');
INSERT INTO vendor_payments VALUES
 ('58000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','20000000-0000-4000-8000-000000000001','payments/pay-a.pdf'),
 ('58000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','20000000-0000-4000-8000-000000000011','payments/pay-b.pdf');
INSERT INTO vendor_payment_allocations VALUES
 ('58100000-0000-4000-8000-000000000001','58000000-0000-4000-8000-000000000001'),
 ('58100000-0000-4000-8000-000000000011','58000000-0000-4000-8000-000000000011');
INSERT INTO vendor_advance_adjustments VALUES
 ('58200000-0000-4000-8000-000000000001','58000000-0000-4000-8000-000000000001'),
 ('58200000-0000-4000-8000-000000000011','58000000-0000-4000-8000-000000000011');
INSERT INTO vendor_payment_events VALUES
 ('58300000-0000-4000-8000-000000000001','58000000-0000-4000-8000-000000000001'),
 ('58300000-0000-4000-8000-000000000011','58000000-0000-4000-8000-000000000011');
INSERT INTO vendor_invoices VALUES
 ('59000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','20000000-0000-4000-8000-000000000001','invoices/invoice-a.pdf'),
 ('59000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','20000000-0000-4000-8000-000000000011','invoices/invoice-b.pdf');
INSERT INTO accounts VALUES
 ('60000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','AP'),
 ('60000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','AP');
INSERT INTO journal_entries VALUES
 ('61000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','20000000-0000-4000-8000-000000000001'),
 ('61000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','20000000-0000-4000-8000-000000000011');
INSERT INTO journal_lines VALUES
 ('61100000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001'),
 ('61100000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000011');
INSERT INTO audit_logs VALUES
 ('62000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','{"a":1}','{"b":1}'),
 ('62000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011','{"b":1}','{"b":2}'),
 ('62000000-0000-4000-8000-000000000099',NULL,'{"system":true}','{"system":true}');
INSERT INTO storage.objects VALUES
 ('63000000-0000-4000-8000-000000000001','vendor-documents','invoices/invoice-a.pdf'),
 ('63000000-0000-4000-8000-000000000002','vendor-documents','payments/pay-a.pdf'),
 ('63000000-0000-4000-8000-000000000011','vendor-documents','invoices/invoice-b.pdf'),
 ('63000000-0000-4000-8000-000000000012','vendor-documents','payments/pay-b.pdf'),
 ('63000000-0000-4000-8000-000000000099','vendor-documents','invoices/orphan.pdf'),
 ('63000000-0000-4000-8000-000000000098','public-assets','other/public.pdf');
