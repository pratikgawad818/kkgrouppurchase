"""Disposable PostgreSQL proof: only Super Admin and Accounts Manager manage bank data."""
import os
from pathlib import Path
from uuid import UUID
import psycopg

dsn = os.environ["BANK_QA_DSN"]
migration = Path("drizzle/migrations/0116_account_and_vendor_bank_management.sql").read_text()
schema = """
DO $$
BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TYPE public.app_role AS ENUM ('super_admin','accounts_manager','purchase_manager');
CREATE TABLE public.permissions(code text PRIMARY KEY,module text,description text,sort_order integer);
INSERT INTO public.permissions VALUES('company.manage','Company','Manage company',10),
 ('company.bank.view','Company','View bank',12),
 ('vendors.manage','Vendors','Manage vendors',73);
CREATE TABLE public.role_permissions(role app_role,permission_code text,
 UNIQUE(role,permission_code));
INSERT INTO public.role_permissions VALUES
 ('super_admin','company.manage'),('super_admin','company.bank.view'),
 ('accounts_manager','company.bank.view'),('accounts_manager','vendors.manage'),
 ('purchase_manager','vendors.manage'),('super_admin','vendors.manage');
CREATE TABLE public.profiles(id uuid PRIMARY KEY,company_id uuid,is_active boolean);
CREATE TABLE public.user_roles(user_id uuid,role app_role);
CREATE TABLE public.legal_entities(id uuid PRIMARY KEY,company_id uuid);
CREATE TABLE public.company_bank_accounts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,
 account_name text NOT NULL,bank_name text NOT NULL,branch text,
 account_number text NOT NULL,ifsc text NOT NULL, account_type text DEFAULT 'current',
 purpose text,is_primary boolean DEFAULT false,status text DEFAULT 'active');
CREATE TABLE public.vendors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,company_name text,
 contact_person text,bank_account_name text,bank_name text,
 bank_account_number text,ifsc text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
 LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
 $$;
CREATE OR REPLACE FUNCTION public.actor_in_company(_company uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid()
    AND company_id=_company AND is_active)
 $$;
CREATE OR REPLACE FUNCTION public.has_role(_user uuid,_role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_user AND role=_role)
 $$;
CREATE OR REPLACE FUNCTION public.has_permission(_user uuid,_perm text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM user_roles r JOIN profiles p ON p.id=r.user_id
    JOIN role_permissions rp ON rp.role=r.role AND rp.permission_code=_perm
    WHERE r.user_id=_user AND p.is_active) OR EXISTS(
      SELECT 1 FROM user_roles r JOIN profiles p ON p.id=r.user_id
      WHERE r.user_id=_user AND p.is_active AND r.role='super_admin')
 $$;
GRANT USAGE ON SCHEMA auth,public TO authenticated,anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth,public TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON public.company_bank_accounts TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE ON public.vendors TO authenticated;
ALTER TABLE public.company_bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Manage bank accounts" ON public.company_bank_accounts FOR ALL
 TO authenticated USING(public.actor_in_company(company_id) AND
 public.has_permission(auth.uid(),'company.manage'))
 WITH CHECK(public.actor_in_company(company_id) AND
 public.has_permission(auth.uid(),'company.manage'));
CREATE POLICY "View bank accounts" ON public.company_bank_accounts FOR SELECT TO authenticated
 USING(public.actor_in_company(company_id) AND
 public.has_permission(auth.uid(),'company.bank.view'));
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendor manager" ON public.vendors FOR ALL TO authenticated
 USING(public.actor_in_company(company_id)
  AND public.has_permission(auth.uid(),'vendors.manage'))
 WITH CHECK(public.actor_in_company(company_id)
  AND public.has_permission(auth.uid(),'vendors.manage'));
"""

def uid(i):
    return str(UUID(int=i))

company=uid(10); another=uid(11); entity=uid(20); other_entity=uid(21)
sa=uid(101); am=uid(102); pm=uid(103)
with psycopg.connect(dsn,autocommit=True) as conn:
    with conn.cursor() as c:
        c.execute(schema)
        c.execute(migration)
        c.executemany("INSERT INTO public.profiles VALUES (%s,%s,true)",
                      [(sa,company),(am,company),(pm,company)])
        c.executemany("INSERT INTO public.user_roles VALUES (%s,%s::public.app_role)",
                      [(sa,'super_admin'),(am,'accounts_manager'),(pm,'purchase_manager')])
        c.executemany("INSERT INTO public.legal_entities VALUES (%s,%s)",
                      [(entity,company),(other_entity,another)])
        def as_role(user):
            c.execute("RESET ROLE")
            c.execute("SELECT set_config('request.jwt.claim.sub',%s,false)",(user,))
            c.execute("SET ROLE authenticated")
        def denied(sql,args):
            try:
                c.execute(sql,args)
            except psycopg.Error:
                return
            raise AssertionError("Expected access denied")
        as_role(am)
        c.execute("""INSERT INTO public.company_bank_accounts
            (company_id,account_name,account_holder_name,bank_name,account_number,ifsc,legal_entity_id)
            VALUES(%s,'Operations','Kanesa Edifice','HDFC','123456789012','HDFC0001234',%s) RETURNING id""",
            (company,entity))
        bank_id=c.fetchone()[0]
        denied("UPDATE public.company_bank_accounts SET legal_entity_id=%s WHERE id=%s",
               (other_entity,bank_id))
        denied("DELETE FROM public.company_bank_accounts WHERE id=%s",(bank_id,))
        as_role(pm)
        denied("""INSERT INTO public.company_bank_accounts
           (company_id,account_name,bank_name,account_number,ifsc)
           VALUES(%s,'Unauthorised','HDFC','987654321123','HDFC0001234')""",(company,))
        as_role(sa)
        c.execute("UPDATE public.company_bank_accounts SET account_holder_name='K.K. Construction' WHERE id=%s",(bank_id,))
        as_role(pm)
        c.execute("INSERT INTO public.vendors(company_id,company_name,contact_person) VALUES (%s,'Supplier','Contact') RETURNING id",(company,))
        vendor_id=c.fetchone()[0]
        c.execute("UPDATE public.vendors SET contact_person='Updated contact' WHERE id=%s",(vendor_id,))
        denied("""UPDATE public.vendors SET bank_account_name='Unauthorised',
          bank_name='Bank',bank_account_number='123456789012',ifsc='HDFC0001234' WHERE id=%s""",(vendor_id,))
        denied("""INSERT INTO public.vendors(company_id,company_name,bank_account_name,bank_name,bank_account_number,ifsc)
          VALUES(%s,'Spoof','Unauthorized','Bank','123456789012','HDFC0001234')""",(company,))
        as_role(am)
        c.execute("""UPDATE public.vendors SET bank_account_name='Correct Account Name',
          bank_name='Bank of India',bank_account_number='123456789012',ifsc='BKID0001234' WHERE id=%s""",(vendor_id,))
        c.execute("SELECT bank_account_name FROM public.vendors WHERE id=%s",(vendor_id,))
        assert c.fetchone()[0]=='Correct Account Name'
        c.execute("SELECT count(*) FROM public.company_bank_accounts")
        assert c.fetchone()[0]==1
print("PASS: scoped accounts manager + super admin rights, blocked vendor bank bypass, no deletes")
