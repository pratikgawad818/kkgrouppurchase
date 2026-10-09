"""Acceptance of actual 0012 + 0013 director migrations in disposable PostgreSQL.

This exercises real purchase-order/payment transition functions, director votes
and the company-scoped vote RLS policy. Business dependencies (e.g. general
ledger writer) are explicit QA spies and are NOT full end-to-end certification.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[2]
DSN = os.getenv("DIRECTORS_QA_DSN")
DIRS_A = [f"10000000-0000-4000-8000-{i:012d}" for i in (1, 2, 3)]
DIRS_B = [f"10000000-0000-4000-8000-{i:012d}" for i in (11, 12, 13)]
PURCHASER_A = "10000000-0000-4000-8000-000000000004"
ACCOUNTANT_A = "10000000-0000-4000-8000-000000000005"
ADMIN_A = "10000000-0000-4000-8000-000000000006"
PO_A = "30000000-0000-4000-8000-000000000001"
PO_REJECT = "30000000-0000-4000-8000-000000000002"
PO_SELF = "30000000-0000-4000-8000-000000000003"
PO_QUORUM = "30000000-0000-4000-8000-000000000004"
PO_B = "30000000-0000-4000-8000-000000000005"
PAY_A = "40000000-0000-4000-8000-000000000001"
PAY_SELF = "40000000-0000-4000-8000-000000000002"
PAY_B = "40000000-0000-4000-8000-000000000003"


def connect(application: str = "directors-qa") -> psycopg.Connection:
    if os.getenv("CI") != "true" or not DSN:
        raise RuntimeError("Director acceptance tests are CI-only, never run against Lovable")
    conn = psycopg.connect(DSN, application_name=application)
    database = conn.execute("SELECT current_database()").fetchone()[0]
    if database != "directors_qa":
        conn.close()
        raise RuntimeError("Refusing director tests against non-disposable database")
    conn.commit()
    return conn


def install() -> None:
    with connect("directors-qa-setup") as c:
        c.autocommit = True
        c.execute((ROOT / "scripts/db/fixtures/director_approvals_disposable.sql").read_text())
        for filename in (
            "0012_three_director_approvals.sql",
            "0013_company_scoped_director_votes.sql",
            "0018_payment_allocation_integrity.sql",
        ):
            c.execute((ROOT / "drizzle/migrations" / filename).read_text())
        assert c.execute("SELECT to_regclass('public.director_approval_votes')").fetchone()[0]
        assert c.execute(
            "SELECT relrowsecurity FROM pg_class WHERE oid='public.director_approval_votes'::regclass"
        ).fetchone()[0]


def as_actor(c: psycopg.Connection, user: str) -> None:
    # SET ROLE simulates the PostgREST authenticated table grants and vote RLS.
    c.execute("SET LOCAL ROLE authenticated")
    c.execute("SELECT set_config('qa.actor',%s,true)", (user,))


def po(c: psycopg.Connection, doc: str, action: str, reason: str = "") -> str:
    return str(c.execute(
        "SELECT public.po_transition(%s::uuid,%s::po_action,%s::text)",
        (doc, action, reason),
    ).fetchone()[0])


def payment(c: psycopg.Connection, doc: str, action: str,
            reason: str = "", details: dict | None = None) -> str:
    return str(c.execute(
        "SELECT public.payment_transition(%s::uuid,%s::text,%s::text,%s::jsonb)",
        (doc, action, reason, json.dumps(details or {})),
    ).fetchone()[0])


def rejected(c: psycopg.Connection, expected: str, action) -> None:
    c.execute("SAVEPOINT qa_expected_reject")
    try:
        action()
    except psycopg.Error as error:
        c.execute("ROLLBACK TO SAVEPOINT qa_expected_reject")
        assert expected in str(error), (expected, error)
        c.execute("RELEASE SAVEPOINT qa_expected_reject")
    else:
        c.execute("ROLLBACK TO SAVEPOINT qa_expected_reject")
        c.execute("RELEASE SAVEPOINT qa_expected_reject")
        raise AssertionError(f"Unsafe action unexpectedly succeeded; expected {expected!r}")


def test_three_director_po_vote_and_company_boundaries() -> None:
    with connect("qa-po-votes") as c:
        as_actor(c, DIRS_A[0])
        assert po(c, PO_A, "approved") == "pending_approval"
        assert c.execute(
            "SELECT count(*) FROM purchase_order_approvals WHERE po_id=%s::uuid", (PO_A,)
        ).fetchone()[0] == 0
        rejected(c, "duplicate key", lambda: po(c, PO_A, "approved"))
        rejected(c, "Purchase order not found", lambda: po(c, PO_B, "approved"))
        rejected(c, "permission denied", lambda: c.execute(
            "INSERT INTO director_approval_votes(entity_type,entity_id,actor_id,decision) "
            "VALUES ('purchase_order',%s::uuid,%s::uuid,'approved')", (PO_SELF, DIRS_A[0])
        ))
        rejected(c, "permission denied", lambda: c.execute(
            "SELECT public.register_director_vote('purchase_order',%s::uuid,'approved','')", (PO_A,)
        ))
        as_actor(c, DIRS_A[1])
        assert po(c, PO_A, "approved") == "pending_approval"
        as_actor(c, DIRS_A[2])
        assert po(c, PO_A, "approved") == "approved"
        approved = c.execute(
            "SELECT status,approved_by FROM purchase_orders WHERE id=%s::uuid", (PO_A,)
        ).fetchone()
        assert approved[0] == "approved" and str(approved[1]) == DIRS_A[2], approved
        assert c.execute(
            "SELECT count(*) FROM director_approval_votes "
            "WHERE entity_type='purchase_order' AND entity_id=%s::uuid", (PO_A,)
        ).fetchone()[0] == 3
        assert c.execute(
            "SELECT count(*) FROM purchase_order_approvals WHERE po_id=%s::uuid", (PO_A,)
        ).fetchone()[0] == 1
        rejected(c, "not pending approval", lambda: po(c, PO_A, "approved"))
        c.rollback()
    print("PASS: actual PO RPC requires three distinct votes, rejects duplicates and cross-company votes")


def test_self_approval_rejection_and_exact_active_director_quorum() -> None:
    with connect("qa-po-denied") as c:
        as_actor(c, DIRS_A[0])
        rejected(c, "You cannot approve or reject a PO you created", lambda: po(c, PO_SELF, "approved"))
        rejected(c, "You cannot approve a payment you scheduled", lambda: payment(c, PAY_SELF, "approve"))
        as_actor(c, PURCHASER_A)
        rejected(c, "No permission to approve purchase orders", lambda: po(c, PO_QUORUM, "approved"))
        rejected(c, "No permission to approve payments", lambda: payment(c, PAY_A, "approve"))
        c.rollback()

    with connect("qa-quorum") as c:
        c.execute("UPDATE profiles SET is_active=false WHERE id=%s::uuid", (DIRS_A[2],))
        as_actor(c, DIRS_A[0])
        rejected(c, "Exactly three active directors required", lambda: po(c, PO_QUORUM, "approved"))
        assert c.execute(
            "SELECT count(*) FROM director_approval_votes WHERE entity_id=%s::uuid", (PO_QUORUM,)
        ).fetchone()[0] == 0
        c.rollback()
    print("PASS: self approval, unprivileged users and two-director quorum rejected")


def test_rejection_reason_and_resubmission_discards_old_votes() -> None:
    with connect("qa-po-reject") as c:
        as_actor(c, DIRS_A[0])
        rejected(c, "A rejection reason is required", lambda: po(c, PO_REJECT, "rejected"))
        assert po(c, PO_REJECT, "rejected", "Wrong rate on quote") == "rejected"
        assert c.execute(
            "SELECT decision,comment FROM director_approval_votes WHERE entity_id=%s::uuid", (PO_REJECT,)
        ).fetchone() == ("rejected", "Wrong rate on quote")
        as_actor(c, PURCHASER_A)
        assert po(c, PO_REJECT, "submitted") == "pending_approval"
        assert c.execute(
            "SELECT count(*) FROM director_approval_votes WHERE entity_id=%s::uuid", (PO_REJECT,)
        ).fetchone()[0] == 0
        as_actor(c, DIRS_A[0])
        assert po(c, PO_REJECT, "approved") == "pending_approval"
        c.rollback()
    print("PASS: rejection must explain why; resubmission restarts director vote history")


def test_payments_require_three_votes_and_cash_post_only_after_record() -> None:
    with connect("qa-payment-votes") as c:
        as_actor(c, DIRS_A[0])
        assert payment(c, PAY_A, "approve") == "scheduled"
        rejected(c, "duplicate key", lambda: payment(c, PAY_A, "approve"))
        rejected(c, "Payment not accessible", lambda: payment(c, PAY_B, "approve"))
        as_actor(c, DIRS_A[1])
        assert payment(c, PAY_A, "approve") == "scheduled"
        assert c.execute(
            "SELECT count(*) FROM qa_journal_calls WHERE source_id=%s::uuid", (PAY_A,)
        ).fetchone()[0] == 0
        as_actor(c, DIRS_A[2])
        assert payment(c, PAY_A, "approve") == "approved"
        assert c.execute(
            "SELECT count(*) FROM qa_journal_calls WHERE source_id=%s::uuid", (PAY_A,)
        ).fetchone()[0] == 0
        rejected(c, "No permission to record payments", lambda: payment(c, PAY_A, "record", details={"reference": "QA-UTR"}))
        as_actor(c, ACCOUNTANT_A)
        rejected(c, "Enter the bank / UTR / cheque reference", lambda: payment(c, PAY_A, "record"))
        assert payment(c, PAY_A, "record", details={"reference": "QA-UTR-NO-MONEY-MOVED"}) == "recorded"
        posted = c.execute(
            "SELECT source,payload FROM qa_journal_calls WHERE source_id=%s::uuid", (PAY_A,)
        ).fetchall()
        assert len(posted) == 1 and posted[0][0] == "vendor_payment", posted
        entries = posted[0][1]
        assert sum(float(line.get("debit", 0)) for line in entries) == 1250
        assert sum(float(line.get("credit", 0)) for line in entries) == 1250
        assert c.execute("SELECT count(*) FROM qa_balance_refreshes").fetchone()[0] == 1
        rejected(c, "Only approved payments can be recorded", lambda: payment(c, PAY_A, "record", details={"reference": "AGAIN"}))
        assert c.execute(
            "SELECT count(*) FROM qa_journal_calls WHERE source_id=%s::uuid", (PAY_A,)
        ).fetchone()[0] == 1
        c.rollback()
    print("PASS: payment approved at third vote; cash-journal spy fires once only on recording")


def test_vote_rls_scoped_to_own_company_for_directors_and_admins() -> None:
    with connect("qa-vote-rls") as c:
        as_actor(c, DIRS_A[0])
        assert po(c, PO_A, "approved") == "pending_approval"
        as_actor(c, DIRS_B[0])
        assert po(c, PO_B, "approved") == "pending_approval"
        own = c.execute(
            "SELECT entity_id FROM director_approval_votes ORDER BY entity_id"
        ).fetchall()
        assert [str(row[0]) for row in own] == [PO_B], own
        as_actor(c, DIRS_A[0])
        own = c.execute("SELECT entity_id FROM director_approval_votes").fetchall()
        assert [str(row[0]) for row in own] == [PO_A], own
        as_actor(c, ADMIN_A)
        own = c.execute("SELECT entity_id FROM director_approval_votes").fetchall()
        assert [str(row[0]) for row in own] == [PO_A], own
        as_actor(c, ACCOUNTANT_A)
        assert c.execute("SELECT count(*) FROM director_approval_votes").fetchone()[0] == 0
        c.rollback()
    print("PASS: authenticated director-vote RLS restricts readers by company and role")



def test_final_payment_scheduling_guards_work_with_real_director_flow() -> None:
    """The latest schedule RPC must reserve balances without bypassing company scope."""
    with connect("qa-combined-scheduling") as c:
        as_actor(c, PURCHASER_A)
        def schedule(invoice_id: str, amount: float, **fields) -> str:
            header = {
                "kind": "invoice",
                "vendor_id": "50000000-0000-4000-8000-000000000001",
                "project_id": "20000000-0000-4000-8000-000000000001",
                "payment_date": "2026-10-09",
                "payment_mode": "neft",
                "bank_account_id": "70000000-0000-4000-8000-000000000011",
                **fields,
            }
            return str(c.execute(
                "SELECT public.schedule_vendor_payment(%s::jsonb,%s::jsonb)",
                (json.dumps(header), json.dumps([{"invoice_id": invoice_id, "amount": amount}])),
            ).fetchone()[0])
        created = schedule("60000000-0000-4000-8000-000000000002", 200)
        assert c.execute(
            "SELECT status,amount FROM vendor_payments WHERE id=%s::uuid", (created,)
        ).fetchone() == ("scheduled", 200)
        rejected(c, "only 300 left to pay", lambda: schedule("60000000-0000-4000-8000-000000000002", 301))
        rejected(c, "Invoice is not accessible", lambda: schedule("60000000-0000-4000-8000-000000000003", 10))
        rejected(c, "Bank account does not belong", lambda: schedule(
            "60000000-0000-4000-8000-000000000002", 1,
            bank_account_id="70000000-0000-4000-8000-000000000012"
        ))
        as_actor(c, DIRS_A[0])
        assert payment(c, created, "approve") == "scheduled"
        as_actor(c, DIRS_A[1])
        assert payment(c, created, "approve") == "scheduled"
        as_actor(c, DIRS_A[2])
        assert payment(c, created, "approve") == "approved"
        assert c.execute(
            "SELECT count(*) FROM qa_journal_calls WHERE source_id=%s::uuid", (created,)
        ).fetchone()[0] == 0
        as_actor(c, ACCOUNTANT_A)
        assert payment(c, created, "record", details={"reference": "QA-COMBINED-UTR"}) == "recorded"
        assert c.execute(
            "SELECT count(*) FROM qa_journal_calls WHERE source_id=%s::uuid", (created,)
        ).fetchone()[0] == 1
        c.rollback()
    print("PASS: migration 0018 scheduling + 0013 three-director vote + recorded posting boundary")

if __name__ == "__main__":
    install()
    test_three_director_po_vote_and_company_boundaries()
    test_self_approval_rejection_and_exact_active_director_quorum()
    test_rejection_reason_and_resubmission_discards_old_votes()
    test_payments_require_three_votes_and_cash_post_only_after_record()
    test_vote_rls_scoped_to_own_company_for_directors_and_admins()
    test_final_payment_scheduling_guards_work_with_real_director_flow()
    print("PASS: actual 0012/0013/0018 approval and payment transitions; isolated acceptance suite")
