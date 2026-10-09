"""Offline PostgreSQL syntax preflight for the six high-risk ERP migrations.

This parser checks SQL statement grammar and migration ordering without
connecting to Supabase. It cannot validate embedded PL/pgSQL bodies,
table definitions against live schema, or business-rule behavior.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from pglast import parse_sql

ROOT = Path(__file__).resolve().parents[2]
JOURNAL = ROOT / "drizzle" / "migrations" / "meta" / "_journal.json"
MIGRATIONS = ROOT / "drizzle" / "migrations"
EXPECTED = [
    "0012_three_director_approvals",
    "0013_company_scoped_director_votes",
    "0014_vendor_delivery_challans",
    "0015_project_material_issues_returns",
    "0016_harden_approval_inventory_acl",
    "0017_invoice_grn_allocation_integrity",
]


def run() -> None:
    entries = json.loads(JOURNAL.read_text(encoding="utf-8"))["entries"]
    tags = [entry["tag"] for entry in entries]
    assert all(tag in tags for tag in EXPECTED), "An ERP migration is missing from the Drizzle journal"
    indexes = [tags.index(tag) for tag in EXPECTED]
    assert indexes == sorted(indexes), "Migrations 0012–0017 are not in deployment order"
    assert len(set(tags)) == len(tags), "Duplicate migration tag in journal"
    if any(not entry["breakpoints"] for entry in entries if entry["tag"] in EXPECTED):
        raise AssertionError("Missing Drizzle statement breakpoints")

    for tag in EXPECTED:
        path = MIGRATIONS / f"{tag}.sql"
        sql = path.read_text(encoding="utf-8")
        try:
            statements = parse_sql(sql)
        except Exception as exc:
            raise RuntimeError(f"{path}: PostgreSQL parser rejected SQL: {exc}") from exc
        if not statements:
            raise AssertionError(f"{path} contains no SQL statements")
        if tag == "0017_invoice_grn_allocation_integrity":
            # pglast parses the outer CREATE FUNCTION, not the PL/pgSQL body.
            # PR #20 originally compiled but failed at runtime because a
            # declared RECORD variable named gi shadowed a locking-table alias.
            function_sql = sql.split(
                "CREATE OR REPLACE FUNCTION public.save_vendor_invoice", 1
            )[1]
            lock_section = function_sql.split("-- Lock GRN headers", 1)[1].split(
                "SELECT id, invoice_number, status INTO dup", 1
            )[0]
            declarations = function_sql.split("BEGIN", 1)[0]
            record_vars = re.findall(r"\\b([a-zA-Z_]\\w*)\\s+record\\b", declarations, re.I)
            for var in record_vars:
                if re.search(rf"\\b{re.escape(var)}\\.", lock_section, re.I):
                    raise AssertionError(
                        f"0017: uninitialized PL/pgSQL record '{var}' "
                        "is referenced in receipt-locking SQL"
                    )
            required = (
                "ORDER BY g.id FOR SHARE",
                "ORDER BY locked_grn_item.id FOR UPDATE",
                "IF avail IS NULL OR avail < 0 OR q > avail",
                "CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoice_items_invoice_grn_uniq",
            )
            for clause in required:
                if clause not in sql:
                    raise AssertionError(f"0017: required quantity guard/lock missing: {clause}")

        print(f"PASS {tag}: {len(statements)} PostgreSQL statements parsed")

    print(
        "Offline grammar and journal checks passed. "
        "Live schema, embedded PL/pgSQL bodies, RLS and finance/inventory "
        "transaction behavior still REQUIRE staging tests."
    )


if __name__ == "__main__":
    run()
