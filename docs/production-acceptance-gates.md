# KK GROUP ERP — director acceptance gate (disposable PostgreSQL)

## Implemented CI checks

This suite installs **the actual SQL from migrations 0012 and 0013** into a purpose-built disposable PostgreSQL 16 database named `directors_qa`. It creates synthetic profiles, role assignments, two companies, pending POs and vendor payments. The full tests invoke the actual `po_transition`, `payment_transition` and `register_director_vote` functions under simulated authenticated sessions.

Checks include:

- The first and second approvals leave a PO/payment pending; only a third unique company-director vote approves it.
- Duplicate voting, self-approval, unprivileged accounts, cross-company voting, and fewer than three active directors are rejected.
- PO rejection requires a reason; correcting and resubmitting starts a new vote cycle.
- A payment approval produces **no cash-journal invocation**; the recorded payment triggers the accounting boundary exactly once. A QA spy records the writer call and confirms debit equals credit.
- RLS restricts direct approval-vote **reads** to active directors/admins for their company; direct table writes and direct vote-RPC invocation are denied.

## Safety boundaries

The Python driver rejects any DSN not targeting the exact database name `directors_qa`, requires `CI=true`, and installs only synthetic records. It uses a **QA journal spy**, not the real accounting journal implementation. Do not infer a full double-entry ledger, production grant audit, production RLS coverage, or authenticated browser validation from a passing test.

## Outstanding production acceptance

| Area | Evidence | Remaining |
|---|---|---|
| Invoice accepted quantity | Isolated PostgreSQL migration 0017 two-session concurrency suite | Actual operator sessions and invoice UI |
| Payment reservations | Isolated PostgreSQL migration 0018 two-session concurrency suite | Real API accounts and full journal reconciliation |
| Three-director PO/payment approvals | Isolated PostgreSQL migrations 0012/0013 with role and company-scope tests | Three separate real Director logins, WhatsApp secure links and desktop/mobile |
| Stock issue/return, GRN and matching | Earlier rollback-only source notes; no reproducible full-E2E CI proof | Create an independent supply-chain fixture and exercise live RPC chain in staging |
| Authenticated app workflow | Source-only UI build and TypeScript | Browser login, route-level permissions, access under restricted staff accounts |
| Finance and accounting | Isolated reservation/concurrency and approval posting-boundary tests | Snapshot-consistent trial balances, account reconciliation and tax validation |
| Deployment | GitHub CI | Lovable publish and production smoke checks, only with explicit permission |

**Go-live decision:** Not ready for real payments until real account + browser + reconciliation gates pass. Do not use Lovable credits or touch the production database while running this suite.


## Final payment migration combined acceptance

The follow-up extends this same isolated suite to install the **complete, actual migration 0018** after 0012/0013, not a standalone or copied function. It exercises schedule -> three independent approvals -> record -> journal-writer spy using the combined latest SQL. Checks reservation overbooking, cross-vendor invoice and cross-company bank account guards. The genuine full accounting journal and the app browser still require separate acceptance.
