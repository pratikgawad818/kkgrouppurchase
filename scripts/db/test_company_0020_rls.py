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


if __name__ == "__main__":
    setup()
    test_company_admin_cannot_read_cross_company_data()
    test_assigned_site_worker_and_boss_do_not_get_admin_visibility()
    test_direct_cross_company_staff_and_project_writes_fail()
    print("PASS: migration 0020 company membership / project staff RLS on disposable PostgreSQL")
