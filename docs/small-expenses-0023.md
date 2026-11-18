# KK GROUP ERP — Small expenses register (0023)

**Operational: enabled in the connected database.** The register tracks **actual paid incidental
expenses** (site tea, local transport, fuel, minor consumables, cleaning,
repairs, office needs) with date, project, optional building, payee, method,
amount, purpose, receipt reference, operator and immutable audit.

It is an operational petty expense log, **not** a general-ledger journal,
bank reconciliation or vendor-invoice payment. Amounts must NOT be added to
vendor bill totals or material consumption costs without accounting-level
deduplication. If an expense relates to a formal bill/PO/payment, use the
procurement/finance workflow instead.

The original 0023 write role was **super_admin only**. From migration 0069,
**Accounts Manager** and **Super Admin** can record expenses and create audited
corrections; Management Viewer remains read-only. Accounts Manager cannot
standalone-void an expense or bypass permanent-deletion safeguards. Amount limited to ₹50,000 per entry and two
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

Schema migration 0023 depends on migrations 0019–0022 and has already been
applied to the connected production database. For future modifications, require
staging replay, a backup, RLS and workflow acceptance, and type regeneration
against the actual deployed schema. Do not replay old migrations against a
running production database.

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

## Accounts Manager permissions and audited corrections (0069)

Migration `0069_accounts_manager_small_expenses.sql` grants
`small_expense.manage` to **Accounts Manager** and **Super Admin**.
Existing `financial.view` controls read access and project-scoped RLS.
Accountants, store staff and management viewers do not gain write privileges.

- **Record expense:** same validations and duplicate-submit protection as 0023.
- **Correct expense:** choose **Correct**, edit the prefilled fields, supply a
  reason of 10–400 characters and submit. The database creates a new expense,
  links `replaces_expense_id` to the original, and voids the original within
  **one transaction**. Both audit events remain available; failures roll back
  the entire correction.
- **Void without replacement:** remains limited to **Super Admin** and always
  requires a reason. Permanent deletion is not granted by this permission.
- **No finance posting side effects:** neither recording nor correction
  creates an invoice, bank payment, journal entry, or stock movement.

The incoming maintainer should verify this against authorized Accounts
Manager and Super Admin test accounts in staging, including retry protection,
project isolation, date limits and cross-company access.
