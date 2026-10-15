"""Verify retirement after historical migration tests in disposable PostgreSQL.

Called with the already guarded QA connection; never opens a live connection.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TABLES = (
    "wa_vendor_consents", "wa_consent_events", "wa_notification_drafts", "wa_notification_events",
    "director_wa_consents", "director_wa_consent_events", "director_wa_outbox", "director_wa_outbox_events",
)

def assert_retired(connection):
    database = connection.execute("SELECT current_database()").fetchone()[0]
    if database not in ("director_wa_qa", "whatsapp_qa"):
        raise RuntimeError("Retirement assertions require a disposable integration QA database")
    # Run as the fixture owner, never an application's service-role session.
    connection.execute("RESET ROLE")
    counts = {}
    for name in TABLES:
        if connection.execute("SELECT to_regclass(%s)", ("public." + name,)).fetchone()[0]:
            counts[name] = connection.execute(f'SELECT count(*) FROM public."{name}"').fetchone()[0]
    assert counts, "Historical fixture must contain integration audit tables"
    business = {}
    for name in ("purchase_orders", "vendor_payments", "vendors", "profiles"):
        if connection.execute("SELECT to_regclass(%s)", ("public." + name,)).fetchone()[0]:
            business[name] = connection.execute(f'SELECT count(*) FROM public."{name}"').fetchone()[0]
    trigger_query = """SELECT t.tgname,t.tgrelid,t.tgfoid FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal
        AND t.tgname NOT IN ('wa_po_status_alert','wa_payment_status_alert')
      ORDER BY t.tgname,t.tgrelid"""
    existing_triggers = connection.execute(trigger_query).fetchall()
    functions = connection.execute("""SELECT p.oid FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN ('po_transition','payment_transition','register_director_vote')
      ORDER BY p.oid""").fetchall()
    migration = (ROOT / "drizzle/migrations/0030_retire_whatsapp_integration.sql").read_text()
    connection.execute(migration)
    connection.execute(migration)  # Repeated retirement must not alter audit history.
    for name, count in counts.items():
        assert connection.execute("SELECT to_regclass(%s)", ("public." + name,)).fetchone()[0] is None
        assert connection.execute(f'SELECT count(*) FROM retired_integrations."{name}"').fetchone()[0] == count
        for role in ("anon", "authenticated", "service_role"):
            for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                assert not connection.execute("SELECT has_table_privilege(%s,%s,%s)",
                    (role, "retired_integrations." + name, privilege)).fetchone()[0]
    for role in ("anon", "authenticated", "service_role"):
        assert not connection.execute("SELECT has_schema_privilege(%s,'retired_integrations','USAGE')", (role,)).fetchone()[0]
    for name, count in business.items():
        assert connection.execute(f'SELECT count(*) FROM public."{name}"').fetchone()[0] == count
    assert connection.execute(trigger_query).fetchall() == existing_triggers
    assert connection.execute("""SELECT p.oid FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN ('po_transition','payment_transition','register_director_vote')
      ORDER BY p.oid""").fetchall() == functions
    assert connection.execute("""SELECT count(*) FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE 'wa\\_%' ESCAPE '\\'""").fetchone()[0] == 0
    assert connection.execute("SELECT count(*) FROM pg_trigger WHERE tgname IN "
        "('wa_po_status_alert','wa_payment_status_alert')").fetchone()[0] == 0
    print("PASS: 0030 retires API/functions/queues, preserves audit rows and business workflows, and is repeatable")
