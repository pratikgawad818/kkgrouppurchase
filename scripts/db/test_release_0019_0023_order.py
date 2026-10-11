"""Rehearse the *exact* pending SQL migrations 0019→0023 as one ordered release.

Only a disposable synthetic PostgreSQL database named release_qa is allowed.
Never runs against Lovable, Supabase production, or an imported real-data dump.
Earlier migration 0000-0018 tables are represented by minimal QA fixtures.
"""
from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

import psycopg

ROOT = Path(__file__).resolve().parents[2]
DSN = os.getenv("RELEASE_QA_DSN")
A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
ADMIN_A = "10000000-0000-4000-8000-000000000001"
ADMIN_B = "10000000-0000-4000-8000-000000000011"
BOSS_A = "10000000-0000-4000-8000-000000000003"
SITE_A = "10000000-0000-4000-8000-000000000002"
PROJECT_A = "20000000-0000-4000-8000-000000000001"
PROJECT_B = "20000000-0000-4000-8000-000000000011"
BUILDING_A = "71100000-0000-4000-8000-000000000001"
VA = "51000000-0000-4000-8000-000000000001"
VB = "51000000-0000-4000-8000-000000000011"
RFQ_A = "77000000-0000-4000-8000-000000000001"


def db():
    if os.getenv("CI") != "true" or not DSN:
        raise RuntimeError("Migration rehearsal is CI-only")
    conn = psycopg.connect(DSN, application_name="0019-0023-ordered-rehearsal")
    if conn.execute("SELECT current_database()").fetchone()[0] != "release_qa":
        conn.close()
        raise RuntimeError("Refusing non-disposable database")
    conn.commit()
    return conn


def install(conn, number, name):
    path = ROOT / "drizzle" / "migrations" / f"{number}_{name}.sql"
    conn.execute(path.read_text(encoding="utf-8"))
    print(f"PASS: installed source migration {number} in release_qa")


def setup():
    with db() as conn:
        conn.autocommit = True
        conn.execute((ROOT / "scripts/db/fixtures/company_scope_disposable.sql").read_text())
        # The historical production database uses app_role enum. The separate
        # 0020 fixture uses text to simplify its isolated tests; the release
        # rehearsal upgrades the fixture's role type to match production.
        conn.execute("""CREATE TYPE public.app_role AS ENUM (
          'super_admin','company_admin','store_manager','auditor'
        )""")
        conn.execute("""ALTER TABLE public.user_roles ALTER COLUMN role
          TYPE public.app_role USING role::public.app_role""")
        conn.execute("""CREATE OR REPLACE FUNCTION public.has_role(_uid uuid,_role text)
          RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
          SELECT EXISTS(SELECT 1 FROM public.user_roles
            WHERE user_id=_uid AND role::text=_role)
          $$""")
        conn.execute("""CREATE TABLE public.permissions(
          code text PRIMARY KEY,module text,description text,sort_order integer
        )""")
        conn.execute("""CREATE TABLE public.role_permissions(
          role public.app_role NOT NULL, permission_code text NOT NULL,
          PRIMARY KEY(role,permission_code)
        )""")
        # Pre-existing 0018-era schema needed by 0019 stock policies.
        conn.execute("""CREATE TABLE public.warehouses(
          id uuid PRIMARY KEY,company_id uuid NOT NULL,project_id uuid,name text
        )""")
        conn.execute("""CREATE TABLE public.warehouse_stock(
          warehouse_id uuid,material_id uuid,quantity_on_hand numeric DEFAULT 0
        )""")
        conn.execute("""CREATE TABLE public.inventory_transactions(
          id uuid PRIMARY KEY,company_id uuid,project_id uuid
        )""")
        conn.execute("ALTER TABLE public.warehouse_stock ENABLE ROW LEVEL SECURITY")
        conn.execute("ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY")
        conn.execute("GRANT SELECT ON public.warehouse_stock,public.inventory_transactions TO authenticated")
        permissions = [
          'company.view','projects.view_all','warehouses.view','materials.view',
          'vendors.view','inventory.view','reports.view','purchase_order.view',
          'vendor_invoice.view','payable.view','payment.view',
        ]
        for code in permissions:
            conn.execute("INSERT INTO public.permissions(code,module,description,sort_order) VALUES(%s,'QA','Old code',100)",(code,))
        conn.execute("CREATE ROLE service_role NOLOGIN")
        # 0019 references the pre-existing 0000-era project-access helper.
        # 0020 immediately replaces this simulated baseline implementation.
        conn.execute("""CREATE FUNCTION public.can_access_project(_user_id uuid,_project_id uuid)
          RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
          SELECT EXISTS (
            SELECT 1 FROM public.projects p
            JOIN public.profiles actor ON actor.id=_user_id
            WHERE p.id=_project_id AND p.company_id=actor.company_id AND actor.is_active
              AND (public.has_permission(_user_id,'projects.view_all') OR EXISTS (
                SELECT 1 FROM public.user_project_assignments a
                WHERE a.user_id=_user_id AND a.project_id=_project_id
              ))
          ) $$""")

        # Rehearse the real release ORDER, not separate ad hoc installations.
        install(conn,"0019","management_viewer_scope")
        install(conn,"0020","company_staff_scope")
        # Fixture operational tables are the pre-existing 0018-era schema.
        # Two tables are already in the base fixture for the 0019 policies.
        fixture = (ROOT / "scripts/db/fixtures/operations_scope_disposable.sql").read_text()
        markers = (
          "CREATE TABLE public.role_permissions (role text NOT NULL, permission_code text NOT NULL, PRIMARY KEY(role,permission_code));",
          "CREATE TABLE public.warehouses (id uuid PRIMARY KEY,company_id uuid NOT NULL,project_id uuid,name text);",
        )
        for marker in markers:
            if fixture.count(marker) != 1:
                raise AssertionError("Operations fixture changed: review ordered-release preconditions")
            fixture = fixture.replace(marker, "")
        # In production legacy auditor permissions already exist BEFORE
        # 0019, whose INSERT is ON CONFLICT DO NOTHING. The operations QA
        # fixture adds legacy rows later; skip their synthetic duplicates.
        auditor_head = "INSERT INTO role_permissions(role,permission_code)\\nSELECT 'auditor'"
        auditor_start = fixture.index(auditor_head)
        auditor_end = fixture.index("]);", auditor_start)
        if auditor_start < 0 or auditor_end < 0:
            raise AssertionError("Auditor fixture changed: verify legacy permissions")
        auditor_block = fixture[auditor_start:auditor_end+3]
        fixture = fixture.replace(auditor_block,
            auditor_block.replace("]);", "]) ON CONFLICT DO NOTHING;"))
        conn.execute(fixture)
        install(conn,"0021","tenant_operations_storage_acl")

        # Pre-existing RFQ/PO and building entities required by 0022-0023.
        conn.execute("ALTER TABLE public.vendors ADD COLUMN mobile text")
        conn.execute("UPDATE public.vendors SET mobile='+919876543210' WHERE id=%s::uuid",(VA,))
        conn.execute("UPDATE public.vendors SET mobile='+919000000011' WHERE id=%s::uuid",(VB,))
        conn.execute("""CREATE TABLE public.rfqs(
          id uuid PRIMARY KEY,company_id uuid NOT NULL,project_id uuid NOT NULL,status text NOT NULL
        )""")
        conn.execute("""CREATE TABLE public.rfq_vendors(
          rfq_id uuid NOT NULL,vendor_id uuid NOT NULL,PRIMARY KEY(rfq_id,vendor_id)
        )""")
        conn.execute("""CREATE TABLE public.purchase_orders(
          id uuid PRIMARY KEY,company_id uuid NOT NULL,project_id uuid NOT NULL,
          vendor_id uuid NOT NULL,status text NOT NULL
        )""")
        conn.execute("""CREATE TABLE public.buildings(
          id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES public.projects(id),name text
        )""")
        conn.execute("GRANT SELECT ON public.rfqs,public.rfq_vendors,public.purchase_orders,public.buildings TO authenticated")
        conn.execute("INSERT INTO public.buildings VALUES(%s::uuid,%s::uuid,'Tower A')",(BUILDING_A,PROJECT_A))
        conn.execute("INSERT INTO public.rfqs VALUES (%s::uuid,%s::uuid,%s::uuid,'draft')",(RFQ_A,A,PROJECT_A))
        conn.execute("INSERT INTO public.rfq_vendors VALUES (%s::uuid,%s::uuid)",(RFQ_A,VA))
        # Insert role action rights before the new communication schema exists.
        conn.execute("""INSERT INTO public.role_permissions(role,permission_code)
          VALUES ('company_admin','rfq.send'),('company_admin','purchase_order.create')""")
        # New 0023 write API deliberately requires super_admin, while legacy
        # fixture actors also keep their company_admin procurement rights.
        conn.execute("INSERT INTO public.user_roles VALUES (%s::uuid,'super_admin'),(%s::uuid,'super_admin')",(ADMIN_A,ADMIN_B))
        install(conn,"0022","whatsapp_consent_outbox")
        install(conn,"0023","small_expenses")


def actor(conn,user):
    conn.execute("SET LOCAL ROLE authenticated")
    conn.execute("SELECT set_config('qa.actor',%s,true)",(user,))


def denied(conn,operation):
    conn.execute("SAVEPOINT release_denied")
    try:
        operation()
    except psycopg.Error:
        conn.execute("ROLLBACK TO SAVEPOINT release_denied")
        conn.execute("RELEASE SAVEPOINT release_denied")
        return
    conn.execute("ROLLBACK TO SAVEPOINT release_denied")
    conn.execute("RELEASE SAVEPOINT release_denied")
    raise AssertionError("Expected denial by ordered-release ACL")


def test_final_schema_and_access():
    with db() as conn:
        objects = [
          'wa_vendor_consents','wa_consent_events','wa_notification_drafts',
          'wa_notification_events','site_small_expenses','site_small_expense_events',
        ]
        for name in objects:
            schema,rls = conn.execute(
              "SELECT to_regclass(%s),c.relrowsecurity FROM pg_class c WHERE c.oid=to_regclass(%s)",
              ("public."+name,"public."+name)
            ).fetchone()
            assert schema and rls,(name,schema,rls)
            assert not conn.execute(
              "SELECT has_table_privilege('authenticated',%s,'INSERT')",
              ("public."+name,)
            ).fetchone()[0],name
            assert not conn.execute(
              "SELECT has_table_privilege('authenticated',%s,'UPDATE')",
              ("public."+name,)
            ).fetchone()[0],name
            assert not conn.execute(
              "SELECT has_table_privilege('authenticated',%s,'DELETE')",
              ("public."+name,)
            ).fetchone()[0],name
        assert conn.execute("SELECT count(*) FROM public.projects").fetchone()[0] == 3
        assert conn.execute("SELECT count(*) FROM public.vendors").fetchone()[0] == 2

    with db() as conn:
        actor(conn,BOSS_A)
        assert conn.execute("SELECT public.has_permission(%s::uuid,'financial.view')",(BOSS_A,)).fetchone()[0]
        assert not conn.execute("SELECT public.has_permission(%s::uuid,'vendors.manage')",(BOSS_A,)).fetchone()[0]
        assert not conn.execute("SELECT public.has_permission(%s::uuid,'rfq.send')",(BOSS_A,)).fetchone()[0]
        assert not conn.execute("SELECT public.has_permission(%s::uuid,'payment.create')",(BOSS_A,)).fetchone()[0]
        assert conn.execute("SELECT count(*) FROM public.wa_vendor_consents").fetchone()[0]==0
        denied(conn,lambda:conn.execute(
          "SELECT public.record_site_small_expense(%s::uuid,%s::uuid,%s::uuid,public.ist_today(),"
          "'transport',120.50,'cash','Supplier','Office tea delivery','R001')",
          (str(uuid4()),PROJECT_A,BUILDING_A)
        ))
        conn.rollback()
    print("PASS: six RLS-enabled read-only client tables and management viewer privileges")


def test_consent_draft_and_expense_after_full_release():
    with db() as conn:
        actor(conn,ADMIN_A)
        consent=conn.execute(
          "SELECT public.wa_record_vendor_consent(%s::uuid,true,'supplier_whatsapp',%s)",
          (VA,"Supplier explicitly opted in for RFQ messages on their current WhatsApp number")
        ).fetchone()[0]
        assert str(consent)==VA
        assert conn.execute("SELECT public.wa_has_current_consent(%s::uuid)",(VA,)).fetchone()[0] is True
        draft=conn.execute(
          "SELECT public.wa_create_notification_draft(%s::uuid,'rfq',%s::uuid,%s)",
          (VA,RFQ_A,"Please quote for the open RFQ")
        ).fetchone()[0]
        assert draft
        eid=conn.execute(
          "SELECT public.record_site_small_expense(%s::uuid,%s::uuid,%s::uuid,"
          "(now() AT TIME ZONE 'Asia/Kolkata')::date,'transport',120.50,"
          "'cash','Site Supplier','Local transport to Building A','R001')",
          (str(uuid4()),PROJECT_A,BUILDING_A)
        ).fetchone()[0]
        assert eid
        assert conn.execute("SELECT count(*) FROM public.site_small_expense_events").fetchone()[0]==1
        assert conn.execute("SELECT count(*) FROM public.wa_notification_events").fetchone()[0]==1
    with db() as conn:
        actor(conn,BOSS_A)
        assert conn.execute("SELECT count(*) FROM public.site_small_expenses").fetchone()[0]==1
        assert conn.execute("SELECT count(*) FROM public.wa_vendor_consents").fetchone()[0]==0
    with db() as conn:
        actor(conn,ADMIN_B)
        assert conn.execute("SELECT count(*) FROM public.site_small_expenses").fetchone()[0]==0
        assert conn.execute("SELECT count(*) FROM public.wa_vendor_consents").fetchone()[0]==0
        assert conn.execute("SELECT count(*) FROM public.wa_notification_drafts").fetchone()[0]==0
        denied(conn,lambda:conn.execute(
          "SELECT public.wa_record_vendor_consent(%s::uuid,true,'supplier_whatsapp',%s)",
          (VA,"Attempt to access someone else's supplier")
        ))
    with db() as conn:
        actor(conn,SITE_A)
        assert conn.execute("SELECT count(*) FROM public.site_small_expenses").fetchone()[0]==0
        denied(conn,lambda:conn.execute(
          "SELECT public.record_site_small_expense(%s::uuid,%s::uuid,%s::uuid,"
          "(now() AT TIME ZONE 'Asia/Kolkata')::date,'transport',50,"
          "'cash','Site Supplier','Site cash expense','R002')",
          (str(uuid4()),PROJECT_A,BUILDING_A)
        ))
    print("PASS: consent and draft, expense audit, viewer read-only, company and staff isolation")


if __name__=="__main__":
    setup()
    test_final_schema_and_access()
    test_consent_draft_and_expense_after_full_release()
    print("PASS: sequential source migrations 0019→0023 on isolated PostgreSQL")
