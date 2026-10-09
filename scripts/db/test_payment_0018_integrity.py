"""CI-only payment allocation integration tests using a disposable PostgreSQL DB.

No Lovable connection, no production data, and no production credentials.
"""
import json
import os
import threading
import time
from pathlib import Path
import psycopg

ROOT = Path(__file__).resolve().parents[2]
DSN = os.environ.get("PAYMENT_QA_DSN")
A = "33333333-3333-4333-8333-333333333333"
B = "44444444-4444-4444-8444-444444444444"
VENDOR_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"
VENDOR_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"
INVOICE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5"
INVOICE_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6"
PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"
BANK_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4"
BANK_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4"


def open_conn(app="payment-qa"):
    if os.environ.get("CI") != "true" or not DSN:
        raise RuntimeError("Only disposable CI runs are permitted")
    c = psycopg.connect(DSN, application_name=app)
    name = c.execute("SELECT current_database()").fetchone()[0]
    if name != "payment_qa":
        c.close()
        raise RuntimeError("Refusing to run payment integration tests on a non-QA database")
    c.commit()
    return c


def actor(conn, user=A):
    conn.execute("SELECT set_config('qa.actor',%s,true)", (user,))


def schedule(conn, vendor, invoice, amount, number, **fields):
    header = {
        "vendor_id": vendor,
        "kind": "invoice",
        "payment_date": "2026-10-09",
        "payment_mode": "neft",
        "reference": "QA-NO-MONEY-MOVED",
        **fields,
    }
    allocations = [{"invoice_id": invoice, "amount": amount}]
    return save(conn, header, allocations)


def save(conn, header, allocations):
    return str(conn.execute(
        "SELECT public.schedule_vendor_payment(%s::jsonb,%s::jsonb)",
        (json.dumps(header), json.dumps(allocations)),
    ).fetchone()[0])


def expect_rejected(conn, expected, action):
    conn.execute("SAVEPOINT bad_payment")
    try:
        action()
        conn.execute("ROLLBACK TO SAVEPOINT bad_payment")
        raise AssertionError(f"Unsafe payment operation unexpectedly succeeded: {expected}")
    except psycopg.Error as exc:
        conn.execute("ROLLBACK TO SAVEPOINT bad_payment")
        if expected not in str(exc):
            raise AssertionError(f"Expected {expected!r}; got {exc}") from exc


def install():
    with open_conn("payment-setup") as c:
        c.autocommit = True
        c.execute((ROOT / "scripts/db/fixtures/payment_0018_disposable.sql").read_text())
        c.execute((ROOT / "drizzle/migrations/0018_payment_allocation_integrity.sql").read_text())
        assert c.execute(
            "SELECT to_regclass('public.vendor_payment_allocations_payment_invoice_uniq') IS NOT NULL"
        ).fetchone()[0], "Missing payment allocation unique index"


def test_payment_business_guards():
    with open_conn("payment-guards") as c:
        actor(c)
        pid = schedule(c, VENDOR_A, INVOICE_A, 60, "QA-A", project_id=PROJECT_A, bank_account_id=BANK_A)
        rows = c.execute(
            "SELECT amount FROM vendor_payment_allocations WHERE payment_id=%s::uuid", (pid,),
        ).fetchall()
        assert rows == [(60,)], rows
        expect_rejected(c, "only 40 left", lambda: schedule(c, VENDOR_A, INVOICE_A, 50, "QA-OVERDUE"))
        expect_rejected(c, "cannot be allocated twice", lambda: save(c, {
            "vendor_id": VENDOR_A,"kind":"invoice","payment_date":"2026-10-09",
        }, [{"invoice_id": INVOICE_A, "amount": 25}, {"invoice_id": INVOICE_A, "amount": 25}]))
        expect_rejected(c, "must have a positive amount", lambda: schedule(c, VENDOR_A, INVOICE_A, -1, "QA-NEG"))
        expect_rejected(c, "must have a positive amount", lambda: schedule(c, VENDOR_A, INVOICE_A, 1.001, "QA-3DEC"))
        expect_rejected(c, "Bank account does not belong", lambda: schedule(c, VENDOR_A, INVOICE_A, 1, "QA-BANK", bank_account_id=BANK_B))
        expect_rejected(c, "Project not accessible", lambda: schedule(c, VENDOR_A, INVOICE_A, 1, "QA-PROJECT", project_id=PROJECT_B))
        expect_rejected(c, "Invoice is not accessible", lambda: schedule(c, VENDOR_A, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5", 1, "QA-INV-OTHER"))
        actor(c, B)
        expect_rejected(c, "Vendor not found for your company", lambda: schedule(c, VENDOR_A, INVOICE_A, 1, "QA-WRONG-ACTOR"))
        actor(c, A)
        print("PASS: payment amount, duplicate invoice, cross-company/project/bank checks")
        # Roll back all synthetic validation rows. Other tests use independent data.
        c.rollback()


def test_cross_company_record_and_cancel():
    with open_conn("payment-role-guards") as c:
        actor(c, A)
        payment_id = schedule(c, VENDOR_A, INVOICE_A, 10, "QA-PAYMENT")
        c.execute("UPDATE vendor_payments SET status='approved' WHERE id=%s::uuid", (payment_id,))
        actor(c, B)
        expect_rejected(c, "Payment not accessible", lambda: c.execute(
            "SELECT public.payment_transition(%s::uuid,'record','',%s::jsonb)",
            (payment_id,json.dumps({"reference":"QA-UTR-100"})),
        ).fetchone())
        expect_rejected(c, "Payment not accessible", lambda: c.execute(
            "SELECT public.payment_transition(%s::uuid,'cancel','reason',%s::jsonb)",
            (payment_id,json.dumps({})),
        ).fetchone())
        actor(c, A)
        status = c.execute(
            "SELECT public.payment_transition(%s::uuid,'record','',%s::jsonb)",
            (payment_id,json.dumps({"reference":"QA-UTR-100"})),
        ).fetchone()[0]
        assert status == "recorded", status
        print("PASS: cross-company payment record/cancel prohibited; own approved payment recorded")
        c.rollback()


def wait_for_lock(app_name, second_done):
    deadline = time.monotonic() + 10
    with open_conn("payment-lock-watcher") as observer:
        observer.autocommit = True
        while time.monotonic() < deadline:
            if second_done.is_set():
                raise AssertionError("Second invoice allocation finished before the first committed")
            row = observer.execute(
                "SELECT wait_event_type FROM pg_stat_activity WHERE application_name=%s AND state='active' LIMIT 1",
                (app_name,),
            ).fetchone()
            if row and row[0] == "Lock":
                return
            time.sleep(0.12)
    raise AssertionError("Second payment did not wait for invoice row lock")


def test_two_staff_cannot_schedule_beyond_invoice_balance():
    first_saved = threading.Event()
    second_started = threading.Event()
    second_done = threading.Event()
    release_first = threading.Event()
    errors_first = []
    errors_second = []
    unexpected_success = []

    def first():
        try:
            with open_conn("payment-first") as c:
                actor(c,A)
                schedule(c,VENDOR_A,INVOICE_A2,70,"QA-CONCURRENT-1")
                first_saved.set()
                if not release_first.wait(12):
                    raise TimeoutError("First payment not released")
                # Transaction commits on normal context exit.
        except Exception as exc:
            errors_first.append(exc)
            first_saved.set()

    def second():
        try:
            if not first_saved.wait(10):
                raise TimeoutError("First save never started")
            with open_conn("payment-second") as c:
                actor(c,A)
                second_started.set()
                unexpected_success.append(schedule(c,VENDOR_A,INVOICE_A2,70,"QA-CONCURRENT-2"))
        except Exception as exc:
            errors_second.append(exc)
        finally:
            second_done.set()

    t1 = threading.Thread(target=first)
    t2 = threading.Thread(target=second)
    t1.start()
    t2.start()
    try:
        assert first_saved.wait(10)
        if errors_first:
            raise errors_first[0]
        assert second_started.wait(10)
        wait_for_lock("payment-second",second_done)
    finally:
        release_first.set()
        t1.join(timeout=15)
        t2.join(timeout=15)
    assert not t1.is_alive() and not t2.is_alive()
    assert not errors_first,errors_first
    assert not unexpected_success,"Overbooked scheduled payments"
    assert len(errors_second)==1,errors_second
    assert "only 30 left" in str(errors_second[0]),errors_second
    with open_conn("payment-verify") as c:
        allocated = c.execute(
            "SELECT SUM(al.amount) FROM vendor_payment_allocations al JOIN vendor_payments p ON p.id=al.payment_id WHERE al.invoice_id=%s::uuid AND p.status IN ('scheduled','approved')",
            (INVOICE_A2,),
        ).fetchone()[0]
        assert allocated==70,allocated
    print("PASS: second scheduled payment waits and cannot reserve more than remaining invoice balance")


if __name__ == "__main__":
    install()
    test_payment_business_guards()
    test_cross_company_record_and_cancel()
    test_two_staff_cannot_schedule_beyond_invoice_balance()
    print("PASS: disposable payment allocation integrity suite")
