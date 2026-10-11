"""Disposable-only PostgreSQL acceptance for site small expenses migration 0023."""
from __future__ import annotations
import os
from pathlib import Path
from uuid import uuid4
from datetime import date,timedelta
import psycopg

ROOT=Path(__file__).resolve().parents[2]
DSN=os.getenv("SMALL_EXPENSE_QA_DSN")
COMPANY_A="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
COMPANY_B="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
ADMIN_A="10000000-0000-4000-8000-000000000001"
ADMIN_B="10000000-0000-4000-8000-000000000011"
SITE_A="10000000-0000-4000-8000-000000000002"
BOSS_A="10000000-0000-4000-8000-000000000003"
PROJECT_A="20000000-0000-4000-8000-000000000001"
PROJECT_B="20000000-0000-4000-8000-000000000011"
BUILDING_A="71100000-0000-4000-8000-000000000001"
BUILDING_B="71100000-0000-4000-8000-000000000011"

def db():
    if os.getenv("CI")!="true" or not DSN:
        raise RuntimeError("Small expense acceptance is CI-only")
    c=psycopg.connect(DSN,application_name="small-expenses-qa")
    if c.execute("SELECT current_database()").fetchone()[0]!="site_expense_qa":
        c.close()
        raise RuntimeError("Refusing non-disposable database")
    c.commit()
    return c

def setup():
    with db() as c:
        c.autocommit=True
        c.execute((ROOT/"scripts/db/fixtures/company_scope_disposable.sql").read_text())
        c.execute((ROOT/"drizzle/migrations/0020_company_staff_scope.sql").read_text())
        c.execute('CREATE POLICY "View accessible projects" ON public.projects '
                  'FOR SELECT TO authenticated USING (public.can_access_project(auth.uid(),id))')
        c.execute("CREATE ROLE service_role NOLOGIN")
        c.execute("""CREATE OR REPLACE FUNCTION public.has_permission(_uid uuid,_code text)
          RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
          SELECT EXISTS(
            SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id=r.user_id
            WHERE r.user_id=_uid AND p.is_active AND
            ((r.role='company_admin' AND _code IN ('financial.view','projects.view_all'))
              OR (r.role='auditor' AND _code='financial.view')))
          $$""")
        c.execute("INSERT INTO public.user_roles VALUES (%s::uuid,'super_admin'),(%s::uuid,'super_admin')",
                  (ADMIN_A,ADMIN_B))
        c.execute("CREATE TABLE public.buildings (id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES public.projects(id),name text)")
        c.execute("INSERT INTO public.buildings VALUES (%s::uuid,%s::uuid,'Tower A'),(%s::uuid,%s::uuid,'Tower B')",
                  (BUILDING_A,PROJECT_A,BUILDING_B,PROJECT_B))
        c.execute((ROOT/"drizzle/migrations/0023_small_expenses.sql").read_text())

def actor(c,user):
    c.execute("SET LOCAL ROLE authenticated")
    c.execute("SELECT set_config('qa.actor',%s,true)",(user,))

def denied(c,operation):
    c.execute("SAVEPOINT expense_denied")
    try: operation()
    except psycopg.Error:
        c.execute("ROLLBACK TO SAVEPOINT expense_denied")
        c.execute("RELEASE SAVEPOINT expense_denied")
        return
    c.execute("ROLLBACK TO SAVEPOINT expense_denied")
    c.execute("RELEASE SAVEPOINT expense_denied")
    raise AssertionError("Expected operation denial")

def record(c,entry_key,project=PROJECT_A,building=BUILDING_A,amount="120.50",description="Construction site drinking water",spent_on=None):
    return c.execute(
      "SELECT public.record_site_small_expense(%s::uuid,%s::uuid,%s::uuid,%s::date,%s,%s::numeric,%s,%s,%s,%s)",
      (entry_key,project,building,spent_on or date.today(),"site_supplies",amount,"cash","Local supplier",
       description,"BILL-2026-01")).fetchone()[0]

def test_create_idempotent_and_void():
    with db() as c:
        actor(c,ADMIN_A)
        key=str(uuid4())
        id1=record(c,key)
        assert id1==record(c,key)
        assert c.execute("SELECT count(*) FROM public.site_small_expense_events").fetchone()[0]==1
        denied(c,lambda:record(c,key,description="Changed detail after initial registration"))
        denied(c,lambda:record(c,str(uuid4()),amount="0"))
        denied(c,lambda:record(c,str(uuid4()),amount="50000.01"))
        denied(c,lambda:record(c,str(uuid4()),amount="1.234"))
        denied(c,lambda:record(c,str(uuid4()),spent_on=date.today()+timedelta(days=1)))
        denied(c,lambda:record(c,str(uuid4()),project=PROJECT_B,building=BUILDING_B))
        denied(c,lambda:record(c,str(uuid4()),project=PROJECT_A,building=BUILDING_B))
        denied(c,lambda:record(c,str(uuid4()),project=None,building=BUILDING_A))
        assert c.execute("SELECT count(*) FROM public.site_small_expenses").fetchone()[0]==1
        c.execute("SELECT public.void_site_small_expense(%s::uuid,%s)",(id1,"Receipt was posted twice"))
        assert c.execute("SELECT status FROM public.site_small_expenses WHERE id=%s::uuid",(id1,)).fetchone()[0]=="voided"
        assert c.execute("SELECT count(*) FROM public.site_small_expense_events").fetchone()[0]==2
        denied(c,lambda:record(c,key)) # voided entry key cannot be recycled
        c.execute("SELECT public.void_site_small_expense(%s::uuid,%s)",(id1,"Repeat void is idempotent"))
        assert c.execute("SELECT count(*) FROM public.site_small_expense_events").fetchone()[0]==2
    print("PASS: actual small expense SQL enforces amount/date/building/company, idempotency, void trail")

def test_rls_and_server_rpc_rights():
    with db() as c:
        actor(c,ADMIN_A)
        active=record(c,str(uuid4()))
        denied(c,lambda:c.execute("UPDATE public.site_small_expenses SET amount=1"))
        denied(c,lambda:c.execute("DELETE FROM public.site_small_expenses"))
        denied(c,lambda:c.execute("INSERT INTO public.site_small_expense_events(company_id,expense_id,action,actor_id) VALUES (%s::uuid,%s::uuid,'recorded',%s::uuid)",(COMPANY_A,active,ADMIN_A)))
        visible=c.execute("SELECT id,status,created_by FROM public.site_small_expenses").fetchall()
        assert len(visible)==2, f"Admin A expected 2 visible rows, got {visible}"
    with db() as c:
        actor(c,BOSS_A)
        assert c.execute("SELECT count(*) FROM public.site_small_expenses").fetchone()[0]==2
        denied(c,lambda:record(c,str(uuid4())))
        denied(c,lambda:c.execute("SELECT public.void_site_small_expense(%s::uuid,%s)",(active,"Not allowed")))
    with db() as c:
        actor(c,SITE_A)
        assert c.execute("SELECT count(*) FROM public.site_small_expenses").fetchone()[0]==0
        denied(c,lambda:record(c,str(uuid4())))
    with db() as c:
        actor(c,ADMIN_B)
        assert c.execute("SELECT count(*) FROM public.site_small_expenses").fetchone()[0]==0
        denied(c,lambda:c.execute("SELECT public.void_site_small_expense(%s::uuid,%s)",(active,"Wrong company")))
        own=record(c,str(uuid4()),project=PROJECT_B,building=BUILDING_B)
        assert own!=active
        assert c.execute("SELECT count(*) FROM public.site_small_expenses").fetchone()[0]==1
    print("PASS: management viewer read-only; no cross-company access; direct tampering denied")

if __name__=="__main__":
    setup()
    test_create_idempotent_and_void()
    test_rls_and_server_rpc_rights()
    print("PASS: staging-only migration 0023 verified on disposable PostgreSQL")
