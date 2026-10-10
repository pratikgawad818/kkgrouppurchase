"""Verify migration 0020 company and staff RLS on disposable PostgreSQL 16."""
from __future__ import annotations

import os
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[2]
DSN = os.environ.get("COMPANY_RLS_QA_DSN")
COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
ADMIN_A = "10000000-0000-4000-8000-000000000001"
SITE_A = "10000000-0000-4000-8000-000000000002"
BOSS_A = "10000000-0000-4000-8000-000000000003"
ADMIN_B = "10000000-0000-4000-8000-000000000011"
SITE_B = "10000000-0000-4000-8000-000000000012"
PROJECT_A = "20000000-0000-4000-8000-000000000001"
PROJECT_A2 = "20000000-0000-4000-8000-000000000002"
PROJECT_B = "20000000-0000-4000-8000-000000000011"


def db() -> psycopg.Connection:
    if os.getenv("CI") != "true" or not DSN:
        raise RuntimeError("Company RLS acceptance is CI-only")
    conn = psycopg.connect(DSN, application_name="company-isolation-qa")
    if conn.execute("SELECT current_database()").fetchone()[0] != "company_rls_qa":
        conn.close()
        raise RuntimeError("Refusing to operate on a non-disposable database")
    conn.commit()
    return conn


def setup():
    with db() as conn:
        conn.autocommit = True
        conn.execute((ROOT / "scripts/db/fixtures/company_scope_disposable.sql").read_text())
        conn.execute((ROOT / "drizzle/migrations/0020_company_staff_scope.sql").read_text())
        conn.execute(
            'CREATE POLICY "View accessible projects" ON public.projects '
            'FOR SELECT TO authenticated USING (public.can_access_project(auth.uid(),id))'
        )
        assert conn.execute("SELECT relrowsecurity FROM pg_class WHERE oid='public.profiles'::regclass").fetchone()[0]


def actor(conn: psycopg.Connection, user: str):
    conn.execute("SET LOCAL ROLE authenticated")
    conn.execute("SELECT set_config('qa.actor',%s,true)", (user,))


def ids(conn: psycopg.Connection, table: str, col: str = "id") -> set[str]:
    # The table and col are static test fixture literals, never user input.
    return {str(row[0]) for row in conn.execute(f"SELECT {col} FROM public.{table}").fetchall()}


def denied(conn: psycopg.Connection, action):
    conn.execute("SAVEPOINT expected_policy_denial")
    try:
        action()
    except psycopg.Error:
        conn.execute("ROLLBACK TO SAVEPOINT expected_policy_denial")
        conn.execute("RELEASE SAVEPOINT expected_policy_denial")
    else:
        conn.execute("ROLLBACK TO SAVEPOINT expected_policy_denial")
        conn.execute("RELEASE SAVEPOINT expected_policy_denial")
        raise AssertionError("Expected a PostgreSQL RLS policy to reject this write")


def test_company_admin_cannot_read_cross_company_data():
    with db() as conn:
        actor(conn, ADMIN_A)
        assert ids(conn, "companies") == {COMPANY_A}
        assert ids(conn, "company_bank_accounts") == {"30000000-0000-4000-8000-000000000001"}
        assert ids(conn, "financial_periods") == {"40000000-0000-4000-8000-000000000001"}
        assert ids(conn, "profiles") == {ADMIN_A, SITE_A, BOSS_A}
        assert ids(conn, "user_roles", "user_id") == {ADMIN_A, SITE_A, BOSS_A}
        assert ids(conn, "projects") == {PROJECT_A, PROJECT_A2}
        assert conn.execute("SELECT public.can_access_project(%s::uuid,%s::uuid)", (ADMIN_A, PROJECT_B)).fetchone()[0] is False
        assert ids(conn, "user_project_assignments", "user_id") == {SITE_A}
        conn.rollback()
    with db() as conn:
        actor(conn, ADMIN_B)
        assert ids(conn, "companies") == {COMPANY_B}
        assert ids(conn, "profiles") == {ADMIN_B, SITE_B}
        assert ids(conn, "projects") == {PROJECT_B}
        assert ids(conn, "user_project_assignments", "user_id") == {SITE_B}
        conn.rollback()
    print("PASS: company administrators see only their own users, projects, banks and periods")


def test_assigned_site_worker_and_boss_do_not_get_admin_visibility():
    with db() as conn:
        actor(conn, SITE_A)
        assert ids(conn, "projects") == {PROJECT_A}
        assert ids(conn, "profiles") == {SITE_A}
        assert ids(conn, "user_roles", "user_id") == {SITE_A}
        assert ids(conn, "company_bank_accounts") == set()
        assert ids(conn, "companies") == {COMPANY_A}
        conn.rollback()
    with db() as conn:
        actor(conn, BOSS_A)
        assert ids(conn, "profiles") == {BOSS_A}
        assert ids(conn, "projects") == set()
        assert ids(conn, "company_bank_accounts") == set()
        conn.rollback()
    print("PASS: site worker project assignments and boss's lack of admin privileges")


def test_direct_cross_company_staff_and_project_writes_fail():
    with db() as conn:
        actor(conn, ADMIN_A)
        assert conn.execute(
            "UPDATE public.profiles SET full_name='BREACH' WHERE id=%s::uuid", (ADMIN_B,)
        ).rowcount == 0
        assert conn.execute(
            "DELETE FROM public.user_roles WHERE user_id=%s::uuid", (ADMIN_B,)
        ).rowcount == 0
        assert conn.execute(
            "UPDATE public.companies SET name='BREACH' WHERE id=%s::uuid", (COMPANY_B,)
        ).rowcount == 0
        assert conn.execute(
            "UPDATE public.company_bank_accounts SET account_name='BREACH' WHERE company_id=%s::uuid", (COMPANY_B,)
        ).rowcount == 0
        denied(conn, lambda: conn.execute(
            "INSERT INTO public.user_roles(user_id,role) VALUES (%s::uuid,'auditor')", (SITE_B,)
        ))
        denied(conn, lambda: conn.execute(
            "INSERT INTO public.user_roles(user_id,role) VALUES (%s::uuid,'super_admin')", (SITE_A,)
        ))
        denied(conn, lambda: conn.execute(
            "INSERT INTO public.user_project_assignments(user_id,project_id) VALUES (%s::uuid,%s::uuid)", (SITE_B,PROJECT_A2)
        ))
        denied(conn, lambda: conn.execute(
            "INSERT INTO public.projects(id,company_id,name) VALUES (gen_random_uuid(),%s::uuid,'Foreign')", (COMPANY_B,)
        ))
        denied(conn, lambda: conn.execute(
            "UPDATE public.projects SET company_id=%s::uuid WHERE id=%s::uuid", (COMPANY_B,PROJECT_A)
        ))
        assert conn.execute(
            "UPDATE public.profiles SET full_name='Site A verified' WHERE id=%s::uuid", (SITE_A,)
        ).rowcount == 1
        conn.rollback()
    print("PASS: direct cross-company writes and client-side super-admin grants are blocked by RLS")



def install_operations_scope():
    with db() as conn:
        conn.autocommit = True
        conn.execute((ROOT / "scripts/db/fixtures/operations_scope_disposable.sql").read_text())
        conn.execute((ROOT / "drizzle/migrations/0021_tenant_operations_storage_acl.sql").read_text())
    print("PASS: real migration 0021 installs with existing 0020 company scoping")


def test_business_master_data_isolation():
    tests = {
        "vendor_categories": ("50000000-0000-4000-8000-000000000001", "50000000-0000-4000-8000-000000000011"),
        "vendors": ("51000000-0000-4000-8000-000000000001", "51000000-0000-4000-8000-000000000011"),
        "units_of_measure": ("52000000-0000-4000-8000-000000000001", "52000000-0000-4000-8000-000000000011"),
        "item_categories": ("53000000-0000-4000-8000-000000000001", "53000000-0000-4000-8000-000000000011"),
        "items": ("54000000-0000-4000-8000-000000000001", "54000000-0000-4000-8000-000000000011"),
        "stock_transfers": ("56000000-0000-4000-8000-000000000001", "56000000-0000-4000-8000-000000000011"),
        "stock_transfer_items": ("57000000-0000-4000-8000-000000000001", "57000000-0000-4000-8000-000000000011"),
        "vendor_payments": ("58000000-0000-4000-8000-000000000001", "58000000-0000-4000-8000-000000000011"),
        "vendor_payment_allocations": ("58100000-0000-4000-8000-000000000001", "58100000-0000-4000-8000-000000000011"),
        "vendor_advance_adjustments": ("58200000-0000-4000-8000-000000000001", "58200000-0000-4000-8000-000000000011"),
        "vendor_payment_events": ("58300000-0000-4000-8000-000000000001", "58300000-0000-4000-8000-000000000011"),
        "accounts": ("60000000-0000-4000-8000-000000000001", "60000000-0000-4000-8000-000000000011"),
        "journal_entries": ("61000000-0000-4000-8000-000000000001", "61000000-0000-4000-8000-000000000011"),
        "journal_lines": ("61100000-0000-4000-8000-000000000001", "61100000-0000-4000-8000-000000000011"),
    }
    with db() as conn:
        actor(conn, ADMIN_A)
        for table, (a, _) in tests.items():
            assert ids(conn,table) == {a}, table
        assert ids(conn,"warehouses") == {
            "55000000-0000-4000-8000-000000000001",
            "55000000-0000-4000-8000-000000000002"
        }
        assert conn.execute("SELECT count(*) FROM public.vendor_category_links").fetchone()[0] == 1
        assert ids(conn, "audit_logs") == {"62000000-0000-4000-8000-000000000001"}
        conn.rollback()
    with db() as conn:
        actor(conn, ADMIN_B)
        for table, (_, b) in tests.items():
            assert ids(conn,table) == {b}, table
        assert ids(conn,"warehouses") == {"55000000-0000-4000-8000-000000000011"}
        assert ids(conn,"audit_logs") == {"62000000-0000-4000-8000-000000000011"}
        conn.rollback()
    print("PASS: no cross-company vendors, materials, transfers, payments, journals or audit rows")


def test_boss_read_only_and_removed_legacy_permissions():
    with db() as conn:
        actor(conn, BOSS_A)
        for permission in ["rfq.view","quotation.view","quotation.compare","ledger.view","purchase_request.view"]:
            assert conn.execute("SELECT public.has_permission(auth.uid(),%s)",(permission,)).fetchone()[0] is False, permission
        for permission in ["inventory.view","materials.view","payable.view","payment.view","financial.view"]:
            assert conn.execute("SELECT public.has_permission(auth.uid(),%s)",(permission,)).fetchone()[0] is True, permission
        assert ids(conn,"vendors") == {"51000000-0000-4000-8000-000000000001"}
        assert ids(conn,"items") == {"54000000-0000-4000-8000-000000000001"}
        assert ids(conn,"vendor_payments") == {"58000000-0000-4000-8000-000000000001"}
        assert ids(conn,"accounts") == set()
        assert ids(conn,"journal_entries") == set()
        assert ids(conn,"audit_logs") == set()
        assert conn.execute(
            "UPDATE public.vendors SET company_name='Tamper' WHERE id=%s::uuid",
            ("51000000-0000-4000-8000-000000000001",)
        ).rowcount == 0
        conn.rollback()
    with db() as conn:
        actor(conn, SITE_A)
        assert ids(conn,"stock_transfers") == {"56000000-0000-4000-8000-000000000001"}
        assert ids(conn,"vendors") == set()
        assert ids(conn,"vendor_payments") == set()
        conn.rollback()
    print("PASS: boss gets only authorized read-only material/payment views; site staff lack finance")


def test_attached_vendor_documents_are_company_restricted():
    with db() as conn:
        actor(conn, ADMIN_A)
        visible = {row[0] for row in conn.execute("SELECT name FROM storage.objects").fetchall()}
        assert visible == {"invoices/invoice-a.pdf","payments/pay-a.pdf"}, visible
        conn.rollback()
    with db() as conn:
        actor(conn, ADMIN_B)
        visible = {row[0] for row in conn.execute("SELECT name FROM storage.objects").fetchall()}
        assert visible == {"invoices/invoice-b.pdf","payments/pay-b.pdf"}, visible
        conn.rollback()
    with db() as conn:
        actor(conn, BOSS_A)
        visible = {row[0] for row in conn.execute("SELECT name FROM storage.objects").fetchall()}
        assert visible == {"invoices/invoice-a.pdf","payments/pay-a.pdf"}, visible
        conn.rollback()
    with db() as conn:
        actor(conn, SITE_A)
        assert conn.execute("SELECT count(*) FROM storage.objects").fetchone()[0] == 0
        conn.rollback()
    print("PASS: signed-file lookup cannot expose foreign/unlinked invoices or payment proofs")


def test_business_mutations_enforce_company_even_with_manager_permission():
    with db() as conn:
        actor(conn, ADMIN_A)
        denied(conn,lambda: conn.execute(
            "INSERT INTO public.vendors(id,company_id,company_name) VALUES "
            "(gen_random_uuid(),%s::uuid,'foreign vendor')",(COMPANY_B,)
        ))
        denied(conn,lambda: conn.execute(
            "INSERT INTO public.items(id,company_id,name) VALUES "
            "(gen_random_uuid(),%s::uuid,'foreign material')",(COMPANY_B,)
        ))
        denied(conn,lambda: conn.execute(
            "INSERT INTO public.warehouses(id,company_id,name) VALUES "
            "(gen_random_uuid(),%s::uuid,'foreign store')",(COMPANY_B,)
        ))
        assert conn.execute(
            "UPDATE public.vendors SET company_name='tampered' WHERE company_id=%s::uuid",
            (COMPANY_B,)
        ).rowcount == 0
        assert conn.execute(
            "DELETE FROM public.items WHERE company_id=%s::uuid",(COMPANY_B,)
        ).rowcount == 0
        conn.rollback()
    print("PASS: company boundary blocks direct vendor, material and store writes")


if __name__ == "__main__":
    setup()
    test_company_admin_cannot_read_cross_company_data()
    test_assigned_site_worker_and_boss_do_not_get_admin_visibility()
    test_direct_cross_company_staff_and_project_writes_fail()
    print("PASS: migration 0020 company membership / project staff RLS on disposable PostgreSQL")
    install_operations_scope()
    test_business_master_data_isolation()
    test_boss_read_only_and_removed_legacy_permissions()
    test_attached_vendor_documents_are_company_restricted()
    test_business_mutations_enforce_company_even_with_manager_permission()
    print("PASS: migration 0021 vendor/material/payment/storage ACL on disposable PostgreSQL")
