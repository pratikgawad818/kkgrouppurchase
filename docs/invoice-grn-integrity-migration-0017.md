# KK GROUP ERP — Invoice/GRN allocation integrity (proposed migration 0017)

**Deployment status: NOT APPLIED. DRAFT SOURCE CHANGE ONLY.** The company asked us to request permission before changing its live Lovable Cloud financial database. Merging this SQL into GitHub would not itself prove it was deployed; do not run SQL in production without a verified maintenance and rollback plan.

## Why this patch exists

The original `save_vendor_invoice` RPC (migration 0005) checked `IF q > avail THEN RAISE EXCEPTION`. Migrations 0007 and 0009 overwrote the RPC **without** that check. The frontend now validates entered quantities (PR #19), but that cannot stop a direct crafted RPC call or simultaneous users billing the same accepted goods.

The current server-side `run_invoice_match` compares each invoice line to a snapshot of `grn_item_available`. Two repeated GRN entries in **one invoice** could each individually appear within available quantity while their sum exceeds the accepted quantity; moreover, two simultaneous invoices can both observe unallocated stock without receipt-row locking. Those are different from intentional rate/GST exceptions and must not become paid invoices.

## Proposed database controls in `0017_invoice_grn_allocation_integrity.sql`

1. Fail migration rather than auto-delete or merge historical invoice items if existing allocations are unsafe:
   - Same `grn_item_id` repeated inside one invoice.
   - Active invoice line source references disagree with the selected GRN item.
   - Active invoice quantities already exceed accepted GRN quantities.
   - Active invoice lines point to GRNs that are not posted.
2. Unique index on `vendor_invoice_items(invoice_id,grn_item_id)`, preventing duplicate use within one bill.
3. Replace `save_vendor_invoice` using the last version from 0009 while adding:
   - Reject duplicate GRN item references within one input payload.
   - Lock all referenced **GRN header rows** in stable order, then all referenced **GRN item rows** in stable order before checking allowance, inserting, or editing invoice items. This serialises competing invoices and protects against concurrent GRN cancellation.
   - Re-check accepted-minus-already-invoiced quantity **inside the database transaction**, reject unknown/negative availability and any requested quantity above allowance.
   - Reject nonpositive item quantities rather than silently ignoring checked lines.
4. Preserve existing vendor bill normalisation/duplicate checks, record numbers, invoice totals, tax, TDS, event history and security-definer access checks.

**Business-policy decision approved:** The new function will **not allow saving an invoice line for more units than have been accepted and are uninvoiced**, including director exception cases. An authorised reviewer can still handle rate/tax exceptions using the existing server match and exception approval workflow, but quantity-overbilling must be corrected at the GRN/bill before an invoice is saved. This approval is not deployment approval; production rollout still needs separate written permission.

## Mandatory read-only preflight

Run `scripts/db/preflight-invoice-grn-allocations.sql` in the **correct project database** using an authorised database operator. Four result sets should contain **zero rows** before rollout:

- Repeated use of the same GRN item in one vendor invoice.
- Active invoice line source-reference mismatches against the actual GRN item.
- Active invoice quantities exceeding accepted GRN quantities in aggregate.
- Active invoices linked to a cancelled or otherwise unposted GRN.

If any rows appear, record and resolve them with Accounts. **Never automatically delete or edit booked financial transactions.**

Take a restorable backup, record existing function definition/hash, confirm migration history through 0016, and deploy 0017 transactionally in an agreed maintenance window. Verify the new unique index and function definition are live. The connected Lovable Cloud database was used for expressly authorised **rollback-only functional tests** on 9 October 2026. No migration was permanently installed.

## Rollback-only functional results — 9 October 2026

**Migration 0017 is still NOT deployed.** A first rollback-only installation passed SQL execution but did not invoke the new function. Calling `save_vendor_invoice` revealed a real runtime defect: its locking block used `gi` as a table alias where `gi` was also a PL/pgSQL RECORD variable. The variable had not been assigned, causing `record "gi" is not assigned yet`.

Follow-up GitHub fix: use `locked_grn_item` consistently for the nested GRN item query, locked item query and `ORDER BY`. Because migration 0017 was never installed, fixing the existing migration file in the source repository does not rewrite an applied migration.

Using `BEGIN; ... migration 0017; SET LOCAL ROLE authenticated; ... ROLLBACK;` on the connected database, the corrected migration passed **13 functional checks**:

1. A valid draft invoice for 4 of 10 accepted units saves; 6 remain.
2. A second invoice asking for 7 when only 6 remain is rejected.
3. Two rows referencing the same GRN item in one invoice are rejected.
4. Editing the draft from 4 to 5 accepted units succeeds, with no double count.
5. Editing that draft to 11 (when only 10 accepted) is rejected.
6. A GRN item belonging to a different PO is rejected.
7. Zero invoice quantity is rejected.
8. All failed attempts leave the valid draft quantity unchanged.
9. A second valid draft can be created in the rollback-only test.
10. `invoice_transition(..., 'submit', ...)` proceeds to `pending_review` for matching amounts.
11. Editing an already submitted invoice is rejected.
12. The unique index rejects a direct duplicate `(invoice_id,grn_item_id)` insert (SQLSTATE 23505).
13. An authenticated actor without an ERP profile/permission cannot create an invoice.

**Isolation verified:** Original `save_vendor_invoice` function MD5 `7a48030b7135dea1d5a3019fd5270ca8` remains unchanged; index absent; migration 0017 not registered; existing invoice headers **6**, invoice lines **6**, GRN items **7**; test document prefixes `QA-%` absent; sample GRN availability restored to **10.000**. The disposable test entries, audit records and document counter updates were rolled back.

**Additional isolated concurrency validation:** GitHub Actions now provisions a disposable PostgreSQL 16 database with synthetic purchasing, receipt and invoice records, installs the *same corrected migration*, and runs a two-connection test using `psycopg`:

- Two simultaneous saves compete for 10 accepted GRN units. One commits 7; the other is observed waiting on a PostgreSQL row lock and then fails to invoice another 7, leaving exactly 3 unallocated.
- A concurrent GRN header `UPDATE` is observed waiting for the first invoice's `FOR SHARE` lock; the simulated header update is then rolled back and the invoice quantity remains consistent.

Both real two-session isolation tests passed. See `scripts/db/test_invoice_0017_concurrency.py`, `scripts/db/fixtures/invoice_0017_disposable.sql`, and the `invoice-allocation-concurrency` CI job.

**Remaining limitation:** This synthetic fixture does **not** implement the full ERP's GRN cancellation RPC, financial journal, audit triggers, RLS, authenticated identity provider, or actual concurrent production load. The presence of the lock is verified, but full GRN cancellation business behavior and invoice-vs-invoice status-transition races still require integration tests with a production-like staging clone. GitHub SQL parser alone cannot prove PL/pgSQL behavior; the staging test now invokes and tests the function itself.

## Required integration tests on a disposable staging database

- Save invoice for a posted GRN: qty <= currently accepted and unallocated succeeds.
- Save qty > available **fails**, without file/line/payment changes.
- Two GRN lines with identical `grn_item_id` in the same invoice **fail**.
- Two simultaneous invoice saves against the same GRN quantity: after one consumes the final accepted units, the other fails rather than double-allocating.
- Edit an existing draft/exception invoice without double-counting its own old quantity; change a submitted/approved invoice remains prohibited.
- Rejected/cancelled invoices do not consume available accepted quantity; fully accepted replacements still count normally.
- Concurrent GRN cancellation and invoice save cannot produce a live bill backed by a cancelled receipt.
- Existing normalised duplicate supplier bill protection still works.
- Existing rate and tax differences still reach the authorisation-controlled exception workflow.
- Cross-company/project user and role permissions remain enforced; no new direct-table grants to `anon` or `authenticated`.
- Check audit events, rolled-back failures, Drizzle migration journal, and newly generated vendor invoice documents.

Offline SQL parsing in GitHub CI only proves outer statement grammar. It **does not** compile procedural bodies or prove locking/concurrency, RLS or transaction correctness.

## User instruction

Do not call Lovable AI, spend credits, publish, or execute a DB migration until the user gives permission. The source fix remains reviewable; production DB deployment still requires a separate explicit user approval. No Lovable AI credits have been used.
