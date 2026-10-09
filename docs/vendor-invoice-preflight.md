# KK GROUP ERP — Vendor Invoice GRN Preflight (client-side)

## Reason for change

The original vendor-invoice form ran `grn_item_available` for each posted goods-receipt line but **ignored per-call errors**, silently converting an RPC error or absent value into a zero available quantity. This could make usable accepted stock appear fully invoiced and mislead Accounts. The form also silently omitted checked lines with blank/zero quantity.

## Safeguards added

1. **Availability lookup errors are fatal to form saving.** Failed individual RPCs or missing/non-finite availability values are shown explicitly with a Retry GRN check button. A failed lookup is **not** treated as zero quantity.
2. **Selected invoice rows cannot be silently omitted.** Every checked line must have a valid positive quantity with up to three decimals, and must not exceed the currently reported accepted, uninvoiced quantity.
3. **Duplicate GRN references are rejected locally.** Reusing the same GRN line twice in one draft is an error.
4. **Rates, GST, TDS, freight and charges are validated** before PDF/image upload and the `save_vendor_invoice` RPC call. Non-finite, negative or overprecision amounts are blocked.
5. **PO rate/GST changes and zero-rate lines are flagged as advisories** before “Save & run match.” These are not server match results, and do not bypass exception review.
6. Source errors and edit-invoice lookup failures are displayed instead of hiding missing records.
7. Switching suppliers or POs clears old GRN lines so stale rows cannot be submitted for a new PO.

The preflight is in `src/lib/invoice-preflight.ts`; regression coverage is `scripts/tests/invoice-preflight.test.mjs`.

## Not a substitute for database controls

The currently committed **migration 0009** overwrote the previous `save_vendor_invoice` function in migration 0005. Unlike the original, this implementation **does not explicitly reject `q > grn_item_available()` at save time**. `invoice_transition` runs 3-way match checks at submit time, but server-side concurrency and duplicate allocation protections should be separately reviewed and tested before treating this as strong anti-overbilling enforcement. A client-side preflight cannot prevent a direct crafted RPC request, a concurrent invoice, or stale availability between read and save.

**No SQL migration is included or deployed in this PR.** Before authorising changes to the live database, test server-side invoice availability against two simultaneous bills for the same GRN, duplicate GRN lines in one invoice, and exception approvals.

## Deployment status

GitHub merge alone synchronises application source. Publishing and authenticated visual QA of the invoice form remain separate. No Lovable AI credits, production database changes or publish actions are required for this PR.
