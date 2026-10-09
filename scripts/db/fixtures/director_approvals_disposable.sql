-- Disposable PostgreSQL director-acceptance environment only.
-- No Lovable endpoints, real credentials, inventory or real accounts.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('qa.actor', true), '')::uuid $$;

CREATE TYPE po_action AS ENUM ('created','submitted','approved','rejected','sent','cancelled','closed');
CREATE TYPE po_status AS ENUM ('draft','pending_approval','approved','rejected','sent','partially_received','partially_accepted','fully_received','short_closed','closed','cancelled');
CREATE TYPE payment_status AS ENUM ('scheduled','approved','recorded','cancelled');
CREATE TYPE payment_kind AS ENUM ('invoice','advance');
CREATE TYPE invoice_status AS ENUM ('draft','pending_review','exception','approved','rejected','partially_paid','paid','cancelled');

CREATE TABLE profiles (
  id uuid PRIMARY KEY, company_id uuid NOT NULL, is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES profiles(id), role text NOT NULL,
  UNIQUE (user_id, role)
);
CREATE TABLE projects (id uuid PRIMARY KEY, company_id uuid NOT NULL);
CREATE TABLE vendors (id uuid PRIMARY KEY, company_id uuid NOT NULL, status text NOT NULL);
CREATE TABLE company_bank_accounts (id uuid PRIMARY KEY, company_id uuid NOT NULL, status text NOT NULL);
CREATE TABLE vendor_invoices (
  id uuid PRIMARY KEY, invoice_number text NOT NULL, vendor_id uuid NOT NULL,
  company_id uuid NOT NULL, project_id uuid NOT NULL, status invoice_status NOT NULL,
  balance_due numeric NOT NULL
);
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY, po_number text NOT NULL, company_id uuid NOT NULL,
  project_id uuid NOT NULL, status po_status NOT NULL, created_by uuid NOT NULL,
  delivery_warehouse_id uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid, approved_at timestamptz, sent_at timestamptz
);
CREATE TABLE purchase_order_approvals (
  po_id uuid NOT NULL, action po_action NOT NULL, acted_by uuid NOT NULL,
  comment text, previous_status po_status, new_status po_status NOT NULL
);
CREATE TABLE goods_receipt_notes (
  po_id uuid NOT NULL, status text NOT NULL
);
CREATE TABLE vendor_payments (
  id uuid PRIMARY KEY, payment_number text NOT NULL, company_id uuid NOT NULL,
  vendor_id uuid NOT NULL, project_id uuid, created_by uuid NOT NULL,
  kind payment_kind NOT NULL, amount numeric NOT NULL, status payment_status NOT NULL,
  payment_date date NOT NULL, payment_mode text NOT NULL DEFAULT 'neft',
  bank_account_id uuid, reference text, proof_path text, remarks text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid, approved_at timestamptz, recorded_by uuid, recorded_at timestamptz
);
CREATE TABLE vendor_payment_events (
  payment_id uuid NOT NULL, action text NOT NULL, acted_by uuid,
  comment text, previous_status payment_status, new_status payment_status NOT NULL
);
CREATE TABLE vendor_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL,
  invoice_id uuid NOT NULL, amount numeric NOT NULL
);
CREATE SEQUENCE qa_payment_numbers;
CREATE FUNCTION public.next_fy_doc_number(_doc text, _prefix text)
RETURNS text LANGUAGE sql VOLATILE AS $
 SELECT _prefix||'-QA-'||nextval('qa_payment_numbers')::text
$;
CREATE TABLE qa_journal_calls (
  source_id uuid NOT NULL, source text NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE qa_balance_refreshes (invoice_id uuid NOT NULL);

CREATE FUNCTION public.has_permission(_uid uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
   SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id=p.id
   WHERE p.id=_uid AND p.is_active
   AND (
     (_perm IN ('purchase_order.approve','payment.approve') AND r.role='director')
     OR (_perm IN ('purchase_order.create','purchase_order.cancel','payment.schedule') AND r.role='purchaser')
     OR (_perm='payment.record' AND r.role='accountant')
     OR (_perm='users.manage' AND r.role='admin')
   )
 )
$$;
CREATE FUNCTION public.can_access_project(_uid uuid, _project uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
   SELECT 1 FROM profiles p JOIN projects pr ON pr.company_id=p.company_id
   WHERE p.id=_uid AND p.is_active AND pr.id=_project
 )
$$;
CREATE FUNCTION public.log_event(
  _action text,_doc_type text,_doc_number text,_record_id uuid,
  _reason text,_old jsonb,_new jsonb
) RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END $$;
CREATE FUNCTION public.post_journal(
  _company uuid,_date date,_source text,_id uuid,_vendor uuid,_project uuid,
  _description text,_lines jsonb
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO qa_journal_calls (source_id,source,payload) VALUES (_id,_source,_lines);
END $$;
CREATE FUNCTION public.vi_refresh_balance(_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO qa_balance_refreshes(invoice_id) VALUES (_id);
END $$;

-- A and B are different companies. Each has exactly three real-role director
-- *fixtures*. The purchaser originates the source document, not a director.
INSERT INTO profiles (id,company_id,is_active) VALUES
 ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true),
 ('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true),
 ('10000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true),
 ('10000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true),
 ('10000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true),
 ('10000000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true),
 ('10000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',true),
 ('10000000-0000-4000-8000-000000000012','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',true),
 ('10000000-0000-4000-8000-000000000013','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',true),
 ('10000000-0000-4000-8000-000000000014','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',true);
INSERT INTO user_roles (user_id,role) VALUES
 ('10000000-0000-4000-8000-000000000001','director'),
 ('10000000-0000-4000-8000-000000000002','director'),
 ('10000000-0000-4000-8000-000000000003','director'),
 ('10000000-0000-4000-8000-000000000004','purchaser'),
 ('10000000-0000-4000-8000-000000000005','accountant'),
 ('10000000-0000-4000-8000-000000000006','admin'),
 ('10000000-0000-4000-8000-000000000011','director'),
 ('10000000-0000-4000-8000-000000000012','director'),
 ('10000000-0000-4000-8000-000000000013','director'),
 ('10000000-0000-4000-8000-000000000014','purchaser');
INSERT INTO projects VALUES
 ('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
 ('20000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
INSERT INTO vendors VALUES
 ('50000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','active'),
 ('50000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','active');
INSERT INTO company_bank_accounts VALUES
 ('70000000-0000-4000-8000-000000000011','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','active'),
 ('70000000-0000-4000-8000-000000000012','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','active');
INSERT INTO vendor_invoices VALUES
 ('60000000-0000-4000-8000-000000000001','QA-INV-A','50000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','20000000-0000-4000-8000-000000000001','approved',1250),
 ('60000000-0000-4000-8000-000000000002','QA-INV-A2','50000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','20000000-0000-4000-8000-000000000001','approved',500),
 ('60000000-0000-4000-8000-000000000003','QA-INV-B','50000000-0000-4000-8000-000000000002',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','20000000-0000-4000-8000-000000000002','approved',750);
INSERT INTO purchase_orders
 (id,po_number,company_id,project_id,status,created_by,delivery_warehouse_id)
VALUES
 ('30000000-0000-4000-8000-000000000001','PO-A-APPROVE','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '20000000-0000-4000-8000-000000000001','pending_approval','10000000-0000-4000-8000-000000000004',
  '70000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000002','PO-A-REJECT','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '20000000-0000-4000-8000-000000000001','pending_approval','10000000-0000-4000-8000-000000000004',
  '70000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000003','PO-A-SELF','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '20000000-0000-4000-8000-000000000001','pending_approval','10000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000004','PO-A-QUORUM','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '20000000-0000-4000-8000-000000000001','pending_approval','10000000-0000-4000-8000-000000000004',
  '70000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000005','PO-B','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  '20000000-0000-4000-8000-000000000002','pending_approval','10000000-0000-4000-8000-000000000014',
  '70000000-0000-4000-8000-000000000002');
INSERT INTO vendor_payments
 (id,payment_number,company_id,vendor_id,project_id,created_by,kind,amount,status,payment_date)
VALUES
 ('40000000-0000-4000-8000-000000000001','PM-A-APPROVE','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000004','invoice',1250,'scheduled','2026-10-09'),
 ('40000000-0000-4000-8000-000000000002','PM-A-SELF','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','invoice',100,'scheduled','2026-10-09'),
 ('40000000-0000-4000-8000-000000000003','PM-B','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  '50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000014','invoice',750,'scheduled','2026-10-09');
INSERT INTO vendor_payment_allocations (payment_id,invoice_id,amount) VALUES
 ('40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',1250);

-- Required for SELECT policy evaluation with simulated authenticated sessions.
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON profiles,user_roles,projects,purchase_orders,vendor_payments,
  purchase_order_approvals,qa_journal_calls,qa_balance_refreshes,
  vendor_payment_allocations,vendor_invoices,vendors,company_bank_accounts TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
