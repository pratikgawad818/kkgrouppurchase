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

## Superseding workflow — 0077 (Small Expense editing and bill evidence)

**Migrations 0023, 0069, 0074 and 0075 are retained unchanged as historical releases.**
Migration `0077_small_expense_edit_bills_access.sql` supersedes their correction and permission model. This source change is **not** evidence that migration 0077 is active in production: first back up and validate the actual connected database; only then apply 0077 and publish the matching app build.

- **Super Admin:** view, record a new expense, edit an existing recorded expense, add/remove bills, permanently delete with explicit confirmation. Real cash/UPI/bank transactions are not reversed by deletion.
- **Accounts Manager:** view and **edit existing** recorded expense fields and attached bills; no new expense creation, permanent deletion, or standalone voiding.
- **Director:** view expense details, bill images/PDFs and change history, but cannot modify expenses or bills. Existing company/project RLS continues to apply.
- **Site staff:** do not inherit finance edit privileges.
- **View-only:** clicking **View** loads a read-only detail dialog and signed-in private bill viewer; it never starts a correction.
- **Edit in place:** `edit_site_small_expense` uses an optimistic `updated_at` lock, validates money/date/category/project/building and changes the **same expense ID**. A new `edited` event records immutable before/after JSON snapshots. Existing statuses and records are not overwritten with void/replacement entries.
- **Historical voids:** previously voided entries remain in the database for the original audit; the live register shows only recorded expenses, so duplicates generated by previous corrections are excluded from totals. The old correction and void RPCs are revoked from authenticated callers.
- **Bill attachments:** private `small-expense-bills` bucket, 8 active files per expense; PDF/JPG/PNG/WebP, 10MB each. `site_small_expense_bills` stores company, expense, uploader and file metadata. Adding/removing attachments uses a guarded RPC and append-only audit event. Removal archives the link; no public file URLs. Read access requires an active link and the expense's company/project/financial permissions. Uploads under `company/uploader/randomUUID.ext` must be owned by the logged-in finance editor.
- **Failure handling:** an expense row may save even if a subsequent storage upload fails. The client reports partial success and prompts users to inspect/retry the missing bill, without creating a duplicate expense record.
- **No accounting side effects:** editing does not post bank entries, vendor invoices, payments, stock movements, or journals. Do not double-count project costs elsewhere.

**Staging acceptance:** disposable PostgreSQL full migration replay (CI's `test_go_live_hardening.py`) verifies same-ID edit, optimistic locking, permission boundaries, uncapped value, private bill access, and Super Admin deletion. Apply migration 0077 only after confirming the deployed database is through migration 0076; revalidate with real Director/Accounts Manager user sessions, a PDF, a photograph, and the expense totals before republishing.

## New role permission — 0078 (Accounts Manager can create expenses)

Migration `0078_accounts_manager_create_small_expenses.sql` supersedes the creation restriction introduced by 0077. **Accounts Manager and Super Admin can both record new Small Expense entries, including receipt/bill images and PDFs** (up to 8 private files, maximum 10 MB each), in addition to viewing and editing the existing expense entries. Accounts Managers still **cannot permanently delete** an expense. Directors remain **view-only** and cannot create, edit, or delete expenses or bills. A dual-role Accounts Manager+Director remains view-only unless separately granted Super Admin.

The database recorder retains the same idempotency key, active-company requirements, date and amount validations, company/project/building checks, and append-only `recorded` audit event. A successful submission keeps the same expense entry even when a later bill upload fails, allowing the missing bill to be attached on edit without duplicate expenses.

Release sequence: apply 0078 only to a backed-up, verified database already through 0077; merge and publish the matching app build. Validate the role gate and a real bill upload with an authorized Accounts Manager session after deployment.
