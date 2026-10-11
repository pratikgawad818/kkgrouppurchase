# KK GROUP ERP — Small expenses register (0023)

**Staging-only / not deployed.** The register tracks **actual paid incidental
expenses** (site tea, local transport, fuel, minor consumables, cleaning,
repairs, office needs) with date, project, optional building, payee, method,
amount, purpose, receipt reference, operator and immutable audit.

It is an operational petty expense log, **not** a general-ledger journal,
bank reconciliation or vendor-invoice payment. Amounts must NOT be added to
vendor bill totals or material consumption costs without accounting-level
deduplication. If an expense relates to a formal bill/PO/payment, use the
procurement/finance workflow instead.

The initial write role is **super_admin only**, matching the user's single
purchase operator. Management Viewer can **read**, not modify, once the
staged DB changes are activated. Amount limited to ₹50,000 per entry and two
decimal places. Greater expenses belong in a reviewed vendor payment flow.

## Corrections and audit

- New records created only via `record_site_small_expense` SQL RPC;
  UUID entry key protects against duplicate clicks or retries.
- Expense rows have no authenticated direct write policies/grants.
- Corrections void the original expense with a mandatory reason via
  `void_site_small_expense`, then record a replacement separately.
- `site_small_expense_events` is append-only audit; no direct writes.
- Voided rows remain readable but are **excluded from active totals**.
- Company/project/building alignment is validated by SQL, including
  unauthorized cross-tenant submissions.

## Activation prerequisites

Schema migration 0023 depends on prior migrations 0019–0022 having been
reviewed in order. **Do not apply directly to production.** Require backup,
staging, RLS and workflow acceptance, and type regeneration against the
actual deployed schema. This PR does not touch live Supabase data, add
payment integrations, publish, or spend Lovable credits.

## Release-readiness improvement (India date and building reporting)

- Expense date is validated against the **Asia/Kolkata business day** in SQL,
  independent of the Supabase/PostgreSQL connection timezone. The UI already
  uses the Indian date; this removes a midnight discrepancy.
- Building filter narrows the expense register and filtered totals; project
  selection resets an incompatible building filter.
- The project summary now also shows **building-wise expense totals**. The
  project total includes general project expenses and individual buildings;
  building totals are a *breakdown*, not extra spending to add again.
- Existing `0023` remains **not applied** in production. This change adjusts
  the pending migration source before a future reviewed deployment.
