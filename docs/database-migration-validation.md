# KK GROUP ERP — Database migration verification (0012–0015)

## Connection/access status

Repository Supabase project reference: `bcyealtsynxuqxqhnxpu` (from `supabase/config.toml`).

**GitHub merge ≠ database migration applied.** The repository's normal GitHub Actions checks build the frontend and run TypeScript. The newly added `migration-syntax` job parses PostgreSQL SQL and verifies the Drizzle journal, but it cannot inspect a live or staging database.

Use a **dedicated staging Supabase project** with the same baseline schema (through `0011`), not live payment/inventory records.

## Offline syntax check

`python -m pip install "pglast>=6,<8"`

`python scripts/db/check_migration_sql.py`

This checks PostgreSQL grammar for SQL migrations `0012`–`0015` and the journal sequence. It does **not** compile PL/pgSQL function bodies, check current database state or run approval/inventory transactions.

## Live database inspection — SELECT-only

Open the **correct** Supabase project's SQL editor and run `scripts/db/preflight-0012-0015.sql`.

The preflight runs inside a `READ ONLY` transaction and always rolls back. It reports:
- Database name and Drizzle migration-history table existence.
- Approval, delivery challan, issue/return tables and RPCs.
- RLS activation on operational source tables.
- Required GRN and inventory-ledger FK columns.
- Unexpected direct INSERT/UPDATE/DELETE grants to `authenticated`.
- Active director account counts by company.

Report **nothing is deployed** unless inspected on the actual intended database. Presence of a table or RPC alone does **not** prove its full body, constraints, policies or Drizzle history match the repository.

## Staging migration and functional testing

1. Confirm the staging database is isolated, backup taken, and baseline schema through `0011` matches GitHub.
2. Apply each migration in order: `0012`, `0013`, `0014`, `0015`, using the configured migration tooling. Read statements and required privileges before executing. Do not blindly replay historical migrations on production.
3. Re-run the SQL preflight. Check all intended tables/functions, RLS and privileges.
4. Create **three genuine staging director users** with independent logins and company membership. Test 1/3, 2/3, 3/3 approvals, duplicate/self/non-director/cross-company votes, rejection and resubmission; verify no bank entry before three approvals.
5. Test a registered vendor challan with partial and concurrent GRNs, cancellation and source linkage; verify no stock increase on challan registration, only on posted GRN.
6. Record a staging issue and two partial returns, including overissue, overreturn and concurrent return negative tests. Verify ledger links, weighted-average cost and project-consumption totals.
7. Verify project/warehouse cross-company access, any RLS leakage, immutable source documents and audit event history.
8. Check integration regressions for existing purchase orders, invoice posting, transfers and payments.

The production release is blocked until staging outcomes and database change history are recorded, and the business owner authorises a rollout.

## Known blockers to report

- If Lovable account/project lookup returns `project_not_found`, the connected Lovable session has no access. Do not interpret that as missing Supabase tables.
- Without an accessible **staging database** or authorised database connection, actual SQL deployment, permission tests, and transactional tests cannot be executed.
- The four SQL files are *not* a safe substitute for actual test results, regardless of passing syntax checks.
- Exactly three active directors per company are necessary for existing vote RPC to approve PO/payments. If a director is the request creator, self-approval restrictions may prevent a 3-of-3 decision; separate requester/operator roles are preferred.
