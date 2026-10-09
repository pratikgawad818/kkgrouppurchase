"""Two-session invoice 0017 integration tests against disposable CI PostgreSQL.

Never points at a Lovable/Supabase DB. Requires CI=true and database name
invoice_qa, populated with synthetic fixtures. No production credentials.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import threading
import time

import psycopg

ROOT = Path(__file__).resolve().parents[2]
DSN = os.environ.get("INVOICE_QA_DSN")
ACTOR = "33333333-3333-4333-8333-333333333333"
PO = "11111111-1111-4111-8111-000000000101"
GRN_ITEM_1 = "11111111-1111-4111-8111-000000000401"
GRN_ITEM_2 = "11111111-1111-4111-8111-000000000402"
GRN_HEADER_2 = "11111111-1111-4111-8111-000000000302"


def open_connection(name: str = "") -> psycopg.Connection:
    if os.environ.get("CI") != "true" or not DSN:
        raise RuntimeError("Invoice integration suite is allowed only in disposable CI")
    conn = psycopg.connect(DSN, application_name=name)
    db = conn.execute("SELECT current_database()").fetchone()[0]
    if db != "invoice_qa":
        conn.close()
        raise RuntimeError("Refusing to execute invoice integration tests against non-QA database")
    conn.commit()
    return conn


def install_fixture() -> None:
    with open_connection("invoice-qa-setup") as conn:
        conn.autocommit = True
        conn.execute(
            (ROOT / "scripts/db/fixtures/invoice_0017_disposable.sql").read_text()
        )
        conn.execute(
            (ROOT / "drizzle/migrations/0017_invoice_grn_allocation_integrity.sql").read_text()
        )
        installed = conn.execute(
            "SELECT to_regclass('public.vendor_invoice_items_invoice_grn_uniq') IS NOT NULL"
        ).fetchone()[0]
        assert installed, "Invoice allocation unique index did not install"


def save(conn: psycopg.Connection, item_id: str, quantity: int, number: str) -> str:
    head = {
        "po_id": PO,
        "vendor_invoice_number": number,
        "vendor_invoice_date": "2026-10-09",
        "freight": 0,
        "other_charges": 0,
        "tds_rate": 0,
    }
    items = [{
        "grn_item_id": item_id,
        "quantity": quantity,
        "rate": 100,
        "tax_rate_percent": 0,
        "tax_type": "none",
    }]
    return str(conn.execute(
        "SELECT public.save_vendor_invoice(NULL::uuid,%s::jsonb,%s::jsonb)",
        (json.dumps(head), json.dumps(items)),
    ).fetchone()[0])


def as_actor(conn: psycopg.Connection) -> None:
    conn.execute("SELECT set_config('qa.actor', %s, true)", (ACTOR,))


def await_lock(name: str, done: threading.Event, limit: float = 8.0) -> None:
    """Poll pg_stat_activity rather than hoping a fixed sleep implies blocking."""
    deadline = time.monotonic() + limit
    with open_connection("invoice-qa-lock-observer") as conn:
        conn.autocommit = True
        while time.monotonic() < deadline:
            if done.is_set():
                raise AssertionError(f"{name} completed before the earlier invoice released its lock")
            row = conn.execute(
                "SELECT wait_event_type,wait_event FROM pg_stat_activity "
                "WHERE application_name=%s AND state='active' ORDER BY pid DESC LIMIT 1",
                (name,),
            ).fetchone()
            if row is not None and row[0] == "Lock":
                return
            time.sleep(0.12)
    raise AssertionError(f"{name} did not wait for a database row lock")


def assert_invoice_content(conn: psycopg.Connection, item_id: str,
                           expected_lines: int, remaining: int) -> None:
    actual = conn.execute(
        "SELECT COUNT(*) FROM vendor_invoice_items WHERE grn_item_id=%s::uuid",
        (item_id,),
    ).fetchone()[0]
    available = conn.execute(
        "SELECT public.grn_item_available(%s::uuid,NULL::uuid)",
        (item_id,),
    ).fetchone()[0]
    assert actual == expected_lines, (actual, expected_lines)
    assert available == remaining, (available, remaining)


def test_two_staff_cannot_overallocate_same_grn() -> None:
    first_saved = threading.Event()
    second_started = threading.Event()
    second_done = threading.Event()
    release_first = threading.Event()
    first_errors: list[Exception] = []
    second_errors: list[Exception] = []
    second_success: list[str] = []

    def first() -> None:
        try:
            with open_connection("invoice-qa-first") as conn:
                as_actor(conn)
                save(conn, GRN_ITEM_1, 7, "QA-SUPPLIER-BILL-A")
                first_saved.set()
                if not release_first.wait(12):
                    raise TimeoutError("First invoice release was not signalled")
                # Commit the accepted quantity while the second call waits.
        except Exception as exc:
            first_errors.append(exc)
            first_saved.set()

    def second() -> None:
        try:
            if not first_saved.wait(10):
                raise TimeoutError("First invoice was not saved in time")
            with open_connection("invoice-qa-second") as conn:
                as_actor(conn)
                second_started.set()
                second_success.append(save(conn, GRN_ITEM_1, 7, "QA-SUPPLIER-BILL-B"))
        except Exception as exc:
            second_errors.append(exc)
        finally:
            second_done.set()

    t1 = threading.Thread(target=first, name="invoice-first")
    t2 = threading.Thread(target=second, name="invoice-second")
    t1.start()
    t2.start()
    try:
        assert first_saved.wait(10), "First worker never reached the invoice lock"
        if first_errors:
            raise first_errors[0]
        assert second_started.wait(10), "Second worker never attempted its save"
        await_lock("invoice-qa-second", second_done)
    finally:
        release_first.set()
        t1.join(timeout=15)
        t2.join(timeout=15)

    assert not t1.is_alive() and not t2.is_alive(), "Invoice workers did not terminate"
    assert not first_errors, first_errors
    assert not second_success, "Both invoices committed even though only 10 units were accepted"
    assert len(second_errors) == 1, second_errors
    assert "Cannot invoice 7" in str(second_errors[0]), second_errors
    with open_connection("invoice-qa-verify") as conn:
        assert_invoice_content(conn, GRN_ITEM_1, expected_lines=1, remaining=3)
    print("PASS: second simultaneous invoice waits, then cannot overbill 10 accepted units")


def test_invoice_lock_blocks_concurrent_grn_header_update() -> None:
    first_saved = threading.Event()
    update_started = threading.Event()
    update_done = threading.Event()
    release_first = threading.Event()
    failures: list[Exception] = []

    def invoice_first() -> None:
        try:
            with open_connection("invoice-qa-header-first") as conn:
                as_actor(conn)
                save(conn, GRN_ITEM_2, 4, "QA-SUPPLIER-BILL-C")
                first_saved.set()
                if not release_first.wait(12):
                    raise TimeoutError("GRN header test release was not signalled")
        except Exception as exc:
            failures.append(exc)
            first_saved.set()

    def update_header() -> None:
        try:
            if not first_saved.wait(10):
                raise TimeoutError("Invoice was not saved in time")
            with open_connection("invoice-qa-header-update") as conn:
                update_started.set()
                conn.execute(
                    "UPDATE goods_receipt_notes SET status='cancelled' WHERE id=%s::uuid",
                    (GRN_HEADER_2,),
                )
                # Never commit this simulated cancellation: it tests locking
                # only, not the real ERP's GRN cancellation business function.
                conn.rollback()
        except Exception as exc:
            failures.append(exc)
        finally:
            update_done.set()

    t1 = threading.Thread(target=invoice_first, name="qa-header-first")
    t2 = threading.Thread(target=update_header, name="qa-header-second")
    t1.start()
    t2.start()
    try:
        assert first_saved.wait(10), "Invoice save did not reach header lock"
        assert update_started.wait(10), "GRN update did not start"
        await_lock("invoice-qa-header-update", update_done)
    finally:
        release_first.set()
        t1.join(timeout=15)
        t2.join(timeout=15)

    assert not t1.is_alive() and not t2.is_alive()
    assert not failures, failures
    with open_connection("invoice-qa-verify-grn") as conn:
        status = conn.execute(
            "SELECT status FROM goods_receipt_notes WHERE id=%s::uuid",
            (GRN_HEADER_2,),
        ).fetchone()[0]
        assert status == "posted", status
        assert_invoice_content(conn, GRN_ITEM_2, expected_lines=1, remaining=6)
    print("PASS: invoice header lock blocks concurrent GRN status update")


if __name__ == "__main__":
    install_fixture()
    test_two_staff_cannot_overallocate_same_grn()
    test_invoice_lock_blocks_concurrent_grn_header_update()
    print("PASS: disposable PostgreSQL invoice concurrency integration suite")
