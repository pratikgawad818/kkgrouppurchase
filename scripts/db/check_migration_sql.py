"""Offline PostgreSQL syntax preflight for the five high-risk ERP migrations.

This parser checks SQL statement grammar and migration ordering without
connecting to Supabase. It cannot validate embedded PL/pgSQL bodies,
table definitions against live schema, or business-rule behavior.
"""
from __future__ import annotations

import json
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
]


def run() -> None:
    entries = json.loads(JOURNAL.read_text(encoding="utf-8"))["entries"]
    tags = [entry["tag"] for entry in entries]
    assert all(tag in tags for tag in EXPECTED), "An ERP migration is missing from the Drizzle journal"
    indexes = [tags.index(tag) for tag in EXPECTED]
    assert indexes == sorted(indexes), "Migrations 0012–0016 are not in deployment order"
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
        print(f"PASS {tag}: {len(statements)} PostgreSQL statements parsed")

    print(
        "Offline grammar and journal checks passed. "
        "Live schema, embedded PL/pgSQL bodies, RLS and finance/inventory "
        "transaction behavior still REQUIRE staging tests."
    )


if __name__ == "__main__":
    run()
