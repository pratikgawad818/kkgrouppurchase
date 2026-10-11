# Stock movement, invoice and payment register responsiveness

Source-only. No real database, Lovable usage or deployment.

## Stock Movements
The existing ledger used `limit(3000)` and silently hid earlier transactions
without warning. It now uses the shared `loadCompleteRows` contract, 250-row
exact-count pages, stable `created_at DESC, id DESC` sorting, and a 10,000
browser record safety cap. An incomplete, changing, or oversized register
fails closed and prompts a retry/server-side report instead of displaying a
misleading partial audit. The ledger's existing warehouse/project/building,
movement type, date and reference search filters are preserved, implemented
in one pure function and memoized on user input/query changes. Search typing
is deferred to protect UI responsiveness, and the existing 25-row table pager
clamps its page if filters shrink the result. Mobile date inputs wrap with
full-width touch-friendly controls. Stock movement queries remain protected
by existing Supabase RLS.

## Vendor Invoices & Payments
The invoice list keeps complete exact-count pagination but defers local
text search, memoizes status/vendor/project/FY filtering and clamps the pager.
Payment history remains complete with its existing mandatory advance-accounting
validation, but its status filter is memoized and its pager clamps after
filter changes. **No financial arithmetic, posting permissions, or payment
validation changes**.

## Known limitations
Fully downloading up to 10,000 ledger rows is appropriate for a bounded
register but can still be costly; large business datasets require a dedicated
server-side filtered ledger/report endpoint with stable pagination and exact
counts. Frontend CI does not measure actual mobile/network latency, so an
authenticated staging browser test remains necessary.

The numeric stock-transaction primary key is normalized to a string **only in the read-only client paging result**, preserving existing database IDs and ledger ordering.
