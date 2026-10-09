# Finance register completeness — 9 October 2026

**Risk:** A PostgREST response may return fewer rows than requested under a backend max-rows limit. Previously Vendor Invoices requested 2,000 and Payables requested 3,000 in one call, then aggregated the results. Financial totals could silently omit invoices.

**Improvement:** Both screens now read invoice rows with stable-ID secondary sorting in 250-row pages using `count: "exact"`. The helper verifies each page has the expected size, the count is stable, record IDs are unique, and total records do not exceed a 10,000-row browser safety limit. On uncertainty, the screen reports an error, not misleading totals, and offers Retry.

**Remaining limitations:** Multiple HTTP pages are not one PostgreSQL snapshot. Use database-side company-scoped aggregates for formal accounting or high-concurrency use. Other financial views may still have truncation and swallowed-error risks. This PR changes only source and CI; no live database write or Lovable publication.

## Vendor Ledger follow-up (PR #27)

The Vendor Ledger previously ignored failed payment, advance-adjustment and PO queries, and its single-response requests could truncate without notice. It now uses the same exact-count paginated verification for vendors, invoices, recorded payments, advance adjustments and approved/in-progress POs. A missing/partial dataset suppresses the balance display with a retryable error. Closed, short-closed and fully received orders are excluded from the active PO face-value reference. The PO face value is **not** a remaining-delivery commitment calculation; that needs line-level reporting.

No database mutation or publication was made. For formal finance reporting a server-side consistent snapshot and reconciled ledger remain required.

## Vendor Payments integrity follow-up — PR #28

- Payment history and advance adjustment records now use verified, paginated reads with exact row counts rather than one capped query. A retrieval error blocks display and offers Retry.
- Advance adjustment sums use integer paise and inconsistent amounts are rejected rather than showing misleading negative balances.
- Scheduled-payment availability checks are vendor-scoped, include all approved invoice reservations in verified pages, and fail closed when incomplete.
- Advance-to-invoice applications require a verified invoice selection, positive amount with two-decimal precision, and sufficient remaining advance and invoice balances. The server's apply_vendor_advance RPC continues to enforce transactional correctness.
- Automated tests cover amount precision, overadjustment and data corruption. No SQL migration, database reset, auto WhatsApp sending or live deployment was performed.

Remaining: PostgREST's multiple page calls are not a transactionally consistent database snapshot; database-side reporting is necessary for accounting sign-off. Proof file uploads also need a separate lifecycle and orphan-cleanup review.
