-- Disposable-only PostgreSQL 16 fixture for migration 0020 RLS regression.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('qa.actor',true),'')::uuid
$$;

CREATE TABLE public.companies (id uuid PRIMARY KEY, name text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, company_id uuid, is_active boolean NOT NULL DEFAULT true, full_name text);
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role text NOT NULL, UNIQUE (user_id,role));
CREATE TABLE public.projects (id uuid PRIMARY KEY,company_id uuid NOT NULL,name text);
CREATE TABLE public.user_project_assignments (user_id uuid NOT NULL,project_id uuid NOT NULL,PRIMARY KEY(user_id,project_id));
CREATE TABLE public.company_bank_accounts (id uuid PRIMARY KEY,company_id uuid NOT NULL,account_name text);
CREATE TABLE public.financial_periods (id uuid PRIMARY KEY,company_id uuid NOT NULL,label text);

CREATE FUNCTION public.has_permission(_uid uuid,_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles r
    JOIN public.profiles p ON p.id=r.user_id
    WHERE r.user_id=_uid AND p.is_active AND r.role='company_admin'
      AND _code IN ('users.manage','projects.manage','projects.view_all',
        'company.manage','company.bank.view')
  )
$$;
CREATE FUNCTION public.has_role(_uid uuid,_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role=_role)
$$;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_periods ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

INSERT INTO companies VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','KK A'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','KK B');
INSERT INTO profiles VALUES
 ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true,'Admin A'),
 ('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true,'Site A'),
 ('10000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true,'Boss A'),
 ('10000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',true,'Admin B'),
 ('10000000-0000-4000-8000-000000000012','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',true,'Site B');
INSERT INTO user_roles VALUES
 ('10000000-0000-4000-8000-000000000001','company_admin'),
 ('10000000-0000-4000-8000-000000000002','store_manager'),
 ('10000000-0000-4000-8000-000000000003','auditor'),
 ('10000000-0000-4000-8000-000000000011','company_admin'),
 ('10000000-0000-4000-8000-000000000012','store_manager');
INSERT INTO projects VALUES
 ('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','A main'),
 ('20000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','A restricted'),
 ('20000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','B main');
INSERT INTO user_project_assignments VALUES
 ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000012','20000000-0000-4000-8000-000000000011');
INSERT INTO company_bank_accounts VALUES
 ('30000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','A bank'),
 ('30000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','B bank');
INSERT INTO financial_periods VALUES
 ('40000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','2026A'),
 ('40000000-0000-4000-8000-000000000011','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','2026B');
