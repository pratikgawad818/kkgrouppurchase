# KK GROUP ERP — Lovable Cloud database rollout (9 October 2026)

**Target:** KK Bussiness Lovable project `5c20d133-20b6-4d66-b67a-f410f9c23457`, Supabase project reference `bcyealtsynxuqxqhnxpu`.

**Applied migrations:** `0012` director votes, `0013` company-scoped vote security, `0014` vendor delivery challans (with guarded optional legacy GRN function revocation), `0015` material issues/returns and reporting, `0016` direct-write privilege hardening. Their exact SQL content SHA-256 values were recorded in `drizzle.__drizzle_migrations` using journal timestamps. Migrations were applied transactionally.

### Verified via connected database

- All seven new document/vote tables, linked GRN and stock transaction columns, and director/GRN/material/reporting RPCs exist.
- Approval, challan, issue and return tables have RLS enabled; their configured client policies are SELECT-only.
- `anon` and `authenticated` have had direct table DML revoked on the new source documents and existing stock ledger, with `authenticated` SELECT restored subject to RLS.
- A simulated **authenticated** super-admin can invoke `record_material_issue` despite lacking direct INSERT permission on `material_issues`.
- One existing open PO accepted a properly linked registered delivery challan in a rollback-only test.
- A rollback-only issue of 3 units followed by a return of 1 reduced temporary stock from 990 to 988 and produced two linked ledger entries. A subsequent read confirmed the original balance 990 and original ledger count 9 remained unchanged.
- Three temporary distinct Directors approved a PO and a scheduled vendor payment in rollback-only transactions. Each became approved on the third vote; the approved-but-unrecorded payment created zero bank/cash journal entries.
- Existing live stock: 3 warehouse/material balances checked against latest ledger balance; zero quantity or warehouse-valuation discrepancies detected.
- Post-test counts: no persistent test approvals, vendor payments, challans, material issues, returns or extra user profiles.

### Still required before accepting real purchase/payment activity

- **Three real, separately authenticated Director accounts** must be invited and assigned the Director role. At migration time there were zero active directors; a super-admin is not automatically a Director. Do not let any of the three directors originate a document they must all approve; self-approval is forbidden.
- UI walkthroughs on mobile and desktop for actual director sessions, deep links, approvals, rejects and cancellation.
- Role and company-boundary RLS tests with real low-privilege authenticated sessions. Tested one authenticated super-admin path only.
- Financial posting, audit-event detail, declined/duplicate/self-votes, concurrent inventory issue/return stress, multiple GRNs for one challan and partial return rounding edge cases under realistic login sessions.
- PDF/receipt/print UX, reports, permissions and alerts may require separate acceptance review.
- Automatic WhatsApp sending remains deferred until the company-owned phone/SIM is ready; manual draft links are independent of the migration rollout.

**Test isolation:** Temporary profiles, votes, challans and stock movements were created within explicit PostgreSQL transactions ending with `ROLLBACK`. No test records were intentionally retained.

**Operational note:** This is the existing Lovable Cloud database, not a staging copy, per the user's express instruction that its current business records are disposable. A Lovable backup was visible in the Cloud UI before migration. Successful SQL installation and selected transaction tests do **not** certify that the entire ERP is defect-free.
