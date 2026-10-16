# KK GROUP ERP — complete Director approvals queue

Prior implementation loaded at most 200 pending POs, 200 scheduled payments, and the first 2,000 historical votes. This could hide a pending approval or display inaccurate director-vote counts once those caps were reached.

The approvals queue reads accessible documents for the selected status using paged exact-count queries, then reads votes and transition events only for the displayed page of documents. Queries are separated by document type and batched into 50 IDs to avoid oversized URL queries. Each batch uses verified paging and stable ID order.

The administrator's active director directory and role memberships are also checked for completeness. On database or permission errors, the UI reports that approval status cannot be verified instead of presenting partial data. The database transition functions still enforce the actual quorum, signer identity, and self-approval rules; UI counts are informational.

This is a source-only improvement with no migration, live database mutation, or deployment. Because the HTTP calls aren't one transaction, directors should refresh before acting; transition RPCs are the authority. Automated CI cannot replace real individual director account acceptance tests.

## Approval queue usability follow-up

The entire verified queue remains searchable by targeted deep link, but the client renders only 15 approval cards per page. Page selection clamps automatically if approval actions reduce the list, avoiding stale blank pages. Responsive paging uses the ERP's standard Pager component. This is not database-side pagination; the full accessible queue is still verified first for reliable counts.

## Decision history and specific document links

Each document tab has a small Pending/Approved/Rejected/Cancelled status selector;
payments use Cancelled because their existing workflow has no rejected state.
Approved history includes subsequently fulfilled/closed POs and recorded payments.
Tab counts represent the selected status, rather than always representing pending work.
Notification links load their exact document even after it leaves the pending queue.

The read-only history combines current director votes with immutable PO/payment
transition events, showing the recorded actor name, date/time and comment. The
final vote and its transition receipt are deduplicated only when document type,
ID, actor, decision and timestamp match. Earlier rejection/approval cycles remain
in transition history after current votes are cleared on resubmission. The
approved-by header is used only as a fallback when older documents have no
available approval events. Unavailable staff names are labelled honestly; no
general profile permissions or RLS policies are expanded.

Only pending documents expose voting controls, and only after their history is
successfully loaded. The database remains authoritative for signer, scope,
self-approval and quorum enforcement. History errors do not imply no decisions.

Full details opens `/procurement/purchase-orders/:id` or the new read-only
`/finance/payments/:id` page. Payment detail includes mode/reference, bank,
creation/approval/recording timestamps, invoice allocations/advance adjustments,
signed proof access and lifecycle history. The existing payment list retains its
mutating actions. Payment-read permission and the Management Viewer whitelist
continue to protect direct links. No schema or production-data changes are required.
