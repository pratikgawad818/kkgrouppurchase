"""Test migration 0022 with real SQL and synthetic two-company fixtures only.

Never connect to a live environment: CI=true and exact database name required.
"""
from __future__ import annotations
import os
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parents[2]
DSN = os.environ.get("WHATSAPP_QA_DSN")
A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
ADMIN_A = "10000000-0000-4000-8000-000000000001"
ADMIN_B = "10000000-0000-4000-8000-000000000011"
BOSS_A = "10000000-0000-4000-8000-000000000003"
SITE_A = "10000000-0000-4000-8000-000000000002"
VA = "51000000-0000-4000-8000-000000000001"
VB = "51000000-0000-4000-8000-000000000011"
RA = "77000000-0000-4000-8000-000000000001"
RB = "77000000-0000-4000-8000-000000000011"
PA = "78000000-0000-4000-8000-000000000001"
PB = "78000000-0000-4000-8000-000000000011"
PENDING_PO = "78000000-0000-4000-8000-000000000002"


def db():
    if os.environ.get("CI") != "true" or not DSN:
        raise RuntimeError("WhatsApp migration acceptance is CI-only")
    conn = psycopg.connect(DSN, application_name="whatsapp-consent-disposable-qa")
    if conn.execute("SELECT current_database()").fetchone()[0] != "whatsapp_qa":
        conn.close()
        raise RuntimeError("Refusing anything except whatsapp_qa")
    conn.commit()
    return conn


def setup():
    with db() as c:
        c.autocommit = True
        c.execute((ROOT / "scripts/db/fixtures/company_scope_disposable.sql").read_text())
        c.execute("CREATE ROLE service_role NOLOGIN")
        c.execute((ROOT / "drizzle/migrations/0020_company_staff_scope.sql").read_text())
        c.execute('CREATE POLICY "View accessible projects" ON public.projects '
                  'FOR SELECT TO authenticated USING (public.can_access_project(auth.uid(),id))')
        c.execute((ROOT / "scripts/db/fixtures/operations_scope_disposable.sql").read_text())
        c.execute((ROOT / "drizzle/migrations/0021_tenant_operations_storage_acl.sql").read_text())
        c.execute("ALTER TABLE public.vendors ADD COLUMN mobile text")
        c.execute("UPDATE public.vendors SET mobile='+919876543210' WHERE id=%s::uuid", (VA,))
        c.execute("UPDATE public.vendors SET mobile='+919000000011' WHERE id=%s::uuid", (VB,))
        c.execute("""CREATE TABLE public.rfqs (
          id uuid PRIMARY KEY,company_id uuid NOT NULL,project_id uuid NOT NULL,status text NOT NULL)""")
        c.execute("""CREATE TABLE public.rfq_vendors (
          rfq_id uuid NOT NULL,vendor_id uuid NOT NULL,PRIMARY KEY(rfq_id,vendor_id))""")
        c.execute("""CREATE TABLE public.purchase_orders (
          id uuid PRIMARY KEY,company_id uuid NOT NULL,project_id uuid NOT NULL,
          vendor_id uuid NOT NULL,status text NOT NULL)""")
        c.execute("GRANT SELECT ON public.rfqs,public.rfq_vendors,public.purchase_orders TO authenticated")
        c.execute("INSERT INTO public.rfqs VALUES (%s::uuid,%s::uuid,%s::uuid,'draft')",
                  (RA, A, "20000000-0000-4000-8000-000000000001"))
        c.execute("INSERT INTO public.rfqs VALUES (%s::uuid,%s::uuid,%s::uuid,'sent')",
                  (RB, B, "20000000-0000-4000-8000-000000000011"))
        c.execute("INSERT INTO public.rfq_vendors VALUES (%s::uuid,%s::uuid),(%s::uuid,%s::uuid)",
                  (RA,VA,RB,VB))
        for poid,company,proj,vendor,status in [
            (PA,A,"20000000-0000-4000-8000-000000000001",VA,"approved"),
            (PB,B,"20000000-0000-4000-8000-000000000011",VB,"approved"),
            (PENDING_PO,A,"20000000-0000-4000-8000-000000000001",VA,"pending_approval")
        ]:
            c.execute("INSERT INTO public.purchase_orders VALUES (%s::uuid,%s::uuid,%s::uuid,%s::uuid,%s)",
                      (poid,company,proj,vendor,status))
        c.execute("""INSERT INTO public.role_permissions(role,permission_code)
            VALUES ('company_admin','rfq.send'),('company_admin','purchase_order.create')""")
        # Install the exact proposed source migration, not a reimplementation.
        c.execute((ROOT / "drizzle/migrations/0022_whatsapp_consent_outbox.sql").read_text())


def actor(conn, user):
    conn.execute("SET LOCAL ROLE authenticated")
    conn.execute("SELECT set_config('qa.actor',%s,true)", (user,))


def denied(conn, operation):
    conn.execute("SAVEPOINT wa_denied")
    try:
        operation()
    except psycopg.Error:
        conn.execute("ROLLBACK TO SAVEPOINT wa_denied")
        conn.execute("RELEASE SAVEPOINT wa_denied")
        return
    conn.execute("ROLLBACK TO SAVEPOINT wa_denied")
    conn.execute("RELEASE SAVEPOINT wa_denied")
    raise AssertionError("Expected denial")


def consent(conn, vendor, grant=True, note="Supplier explicitly opted in via direct conversation."):
    return conn.execute(
      "SELECT public.wa_record_vendor_consent(%s::uuid,%s,%s,%s)",
      (vendor, grant, "supplier_whatsapp", note)).fetchone()[0]


def draft(conn, vendor, document_type, document, message="Please confirm delivery requirements."):
    return conn.execute(
      "SELECT public.wa_create_notification_draft(%s::uuid,%s,%s::uuid,%s)",
      (vendor, document_type, document, message)).fetchone()[0]


def test_consent_lifecycle():
    with db() as conn:
        actor(conn, ADMIN_A)
        assert conn.execute("SELECT public.wa_has_current_consent(%s::uuid)", (VA,)).fetchone()[0] is False
        consent(conn, VA)
        assert conn.execute("SELECT public.wa_has_current_consent(%s::uuid)", (VA,)).fetchone()[0] is True
        assert conn.execute("SELECT count(*) FROM public.wa_consent_events").fetchone()[0] == 1
        consent(conn, VA, False, "Supplier requested WhatsApp notifications stop now.")
        assert conn.execute("SELECT public.wa_has_current_consent(%s::uuid)", (VA,)).fetchone()[0] is False
        assert conn.execute("SELECT previous_status,new_status FROM public.wa_consent_events ORDER BY created_at,id").fetchall()[-1][1] == "revoked"
    print("PASS: explicit consent, audit, opt-out; no implied grant")


def test_cross_company_denials():
    with db() as conn:
        actor(conn, ADMIN_A)
        denied(conn, lambda: consent(conn, VB))
        denied(conn, lambda: draft(conn, VB, "rfq", RB))
        denied(conn, lambda: draft(conn, VA, "rfq", RB))
        denied(conn, lambda: draft(conn, VA, "purchase_order", PB))
        assert conn.execute("SELECT count(*) FROM public.wa_vendor_consents").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM public.wa_consent_events").fetchone()[0] == 2
    with db() as conn:
        actor(conn, ADMIN_B)
        consent(conn, VB)
        assert conn.execute("SELECT count(*) FROM public.wa_vendor_consents").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM public.wa_consent_events").fetchone()[0] == 1
    print("PASS: cross-tenant writes denied and consent/audit RLS isolated")


def test_actor_privileges_and_direct_table_tamper():
    with db() as conn:
        actor(conn, BOSS_A)
        assert conn.execute("SELECT count(*) FROM public.wa_vendor_consents").fetchone()[0] == 0
        denied(conn, lambda: consent(conn, VA))
        denied(conn, lambda: draft(conn, VA, "purchase_order", PA))
        denied(conn, lambda: conn.execute("UPDATE public.wa_vendor_consents SET status='granted'"))
    with db() as conn:
        actor(conn, SITE_A)
        assert conn.execute("SELECT count(*) FROM public.wa_vendor_consents").fetchone()[0] == 0
        denied(conn, lambda: consent(conn, VA))
    with db() as conn:
        actor(conn, ADMIN_A)
        denied(conn, lambda: conn.execute("UPDATE public.wa_vendor_consents SET status='granted'"))
        denied(conn, lambda: conn.execute("DELETE FROM public.wa_consent_events"))
        denied(conn, lambda: conn.execute(
            "INSERT INTO public.wa_notification_drafts(company_id,vendor_id,document_type,document_id,phone_e164,message_body,created_by) "
            "VALUES (%s::uuid,%s::uuid,'rfq',%s::uuid,'919876543210','forged',%s::uuid)",
            (A, VA, RA, ADMIN_A)))
        denied(conn, lambda: conn.execute("UPDATE public.wa_notification_events SET event_type='draft_created'"))
    print("PASS: management viewers/site workers excluded; direct audit/outbox mutation rejected")


def test_stale_phone_guard():
    with db() as conn:
        actor(conn, ADMIN_A)
        consent(conn, VA)
    with db() as conn:
        conn.execute("UPDATE public.vendors SET mobile='+919876543211' WHERE id=%s::uuid", (VA,))
    with db() as conn:
        actor(conn, ADMIN_A)
        assert conn.execute("SELECT public.wa_has_current_consent(%s::uuid)", (VA,)).fetchone()[0] is False
        consent(conn, VA, True, "Supplier confirmed new phone number and WhatsApp opt-in.")
        assert conn.execute("SELECT public.wa_has_current_consent(%s::uuid)", (VA,)).fetchone()[0] is True
    print("PASS: changed vendor phone invalidates old consent until explicitly renewed")


def test_draft_lifecycle():
    with db() as conn:
        actor(conn, ADMIN_A)
        denied(conn, lambda: draft(conn, VA, "purchase_order", PENDING_PO))
        denied(conn, lambda: draft(conn, VA, "rfq", RB))
        denied(conn, lambda: draft(conn, VA, "unsupported", RA))
        id1 = draft(conn, VA, "rfq", RA)
        assert id1 == draft(conn, VA, "rfq", RA)
        assert conn.execute("SELECT count(*) FROM public.wa_notification_events").fetchone()[0] == 1
        denied(conn, lambda: draft(conn, VA, "rfq", RA, "Silent message alteration"))
        id2 = draft(conn, VA, "purchase_order", PA)
        assert id1 != id2
        assert draft(conn, VA, "delivery_followup", PA) not in (id1,id2)
        conn.execute("SELECT public.wa_cancel_notification_draft(%s::uuid,%s)",
                     (id1,"Supplier already answered the quotation request"))
        assert conn.execute("SELECT count(*) FROM public.wa_notification_events").fetchone()[0] == 4
        denied(conn, lambda: draft(conn, VA, "rfq", RA))
        assert conn.execute("SELECT status FROM public.wa_notification_drafts WHERE id=%s::uuid", (id1,)).fetchone()[0] == "cancelled"
        assert conn.execute("SELECT count(*) FROM public.wa_notification_drafts").fetchone()[0] == 3
    with db() as conn:
        actor(conn, ADMIN_B)
        assert conn.execute("SELECT count(*) FROM public.wa_notification_drafts").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM public.wa_notification_events").fetchone()[0] == 0
        denied(conn, lambda: conn.execute("SELECT public.wa_cancel_notification_draft(%s::uuid,%s)", (id1,"Cross-company cancellation")))
    print("PASS: only eligible docs, immutable idempotent draft, cancellation audit, cross-company isolation")


if __name__ == "__main__":
    setup()
    test_consent_lifecycle()
    test_cross_company_denials()
    test_actor_privileges_and_direct_table_tamper()
    test_stale_phone_guard()
    test_draft_lifecycle()
    print("PASS: actual migration 0022 on isolated two-company PostgreSQL")
