-- CI-only disposable schema. No connection to production/Lovable.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('qa.actor',true),'')::uuid $$;
CREATE TYPE payment_status AS ENUM ('scheduled','approved','recorded','cancelled');
CREATE TYPE payment_kind AS ENUM ('invoice','advance');
CREATE TYPE invoice_status AS ENUM ('draft','exception','pending_review','approved','partially_paid','paid','rejected','cancelled');

CREATE TABLE profiles (id uuid PRIMARY KEY,company_id uuid,is_active boolean NOT NULL);
CREATE TABLE projects(id uuid PRIMARY KEY,company_id uuid NOT NULL);
CREATE TABLE vendors(id uuid PRIMARY KEY,company_id uuid NOT NULL,status text NOT NULL);
CREATE TABLE company_bank_accounts(id uuid PRIMARY KEY,company_id uuid NOT NULL,status text NOT NULL);
CREATE TABLE vendor_invoices(
 id uuid PRIMARY KEY,invoice_number text,vendor_id uuid NOT NULL,company_id uuid NOT NULL,
 project_id uuid NOT NULL,status invoice_status NOT NULL,balance_due numeric NOT NULL
);
CREATE TABLE vendor_payments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payment_number text NOT NULL,company_id uuid NOT NULL,vendor_id uuid NOT NULL,
 kind payment_kind NOT NULL,project_id uuid,amount numeric NOT NULL,payment_date date NOT NULL,
 payment_mode text NOT NULL,bank_account_id uuid,reference text,proof_path text,
 remarks text,created_by uuid NOT NULL,status payment_status NOT NULL DEFAULT 'scheduled',
 approved_by uuid,approved_at timestamptz,recorded_by uuid,recorded_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vendor_payment_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payment_id uuid NOT NULL,
 invoice_id uuid NOT NULL,amount numeric NOT NULL
);
CREATE TABLE vendor_payment_events(
 payment_id uuid NOT NULL,action text NOT NULL,acted_by uuid,
 previous_status payment_status,new_status payment_status NOT NULL,comment text
);
CREATE SEQUENCE qa_payment_doc_seq;

CREATE FUNCTION public.has_permission(_uid uuid,_perm text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM profiles WHERE id=_uid AND is_active)
$$;
CREATE FUNCTION public.can_access_project(_uid uuid,_project_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM profiles actor JOIN projects pr ON pr.company_id=actor.company_id
 WHERE actor.id=_uid AND actor.is_active AND pr.id=_project_id)
$$;
CREATE FUNCTION public.next_fy_doc_number(_type text,_prefix text)
RETURNS text LANGUAGE sql VOLATILE AS $$
 SELECT _prefix||'-QA-'||nextval('qa_payment_doc_seq')::text
$$;
CREATE FUNCTION public.register_director_vote(_type text,_id uuid,_decision text,_comment text)
RETURNS integer LANGUAGE sql AS $$ SELECT 3 $$;
CREATE FUNCTION public.post_journal(
 _company uuid,_date date,_source text,_id uuid,_vendor uuid,_project uuid,
 _description text,_lines jsonb
) RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END $$;
CREATE FUNCTION public.vi_refresh_balance(_id uuid) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN NULL; END $$;

INSERT INTO profiles VALUES
 ('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true),
 ('44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',true);
INSERT INTO projects VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
INSERT INTO vendors VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','active'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','active');
INSERT INTO company_bank_accounts VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','active'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','active');
INSERT INTO vendor_invoices VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','INV-A','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','approved',100),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','INV-A2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','approved',100),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5','INV-B','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','approved',200);
