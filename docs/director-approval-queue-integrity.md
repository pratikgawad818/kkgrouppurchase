# KK GROUP ERP — complete Director approvals queue

Prior implementation loaded at most 200 pending POs, 200 scheduled payments, and the first 2,000 historical votes. This could hide a pending approval or display inaccurate director-vote counts once those caps were reached.

The approvals queue now reads all accessible pending POs and scheduled payments using paged exact-count queries, then reads only votes belonging to these open documents. Vote queries are separated by document type and batched into 50 IDs to avoid oversized URL queries. Each batch uses verified paging and stable ID order.

The administrator's active director directory and role memberships are also checked for completeness. On database or permission errors, the UI reports that approval status cannot be verified instead of presenting partial data. The database transition functions still enforce the actual quorum, signer identity, and self-approval rules; UI counts are informational.

This is a source-only improvement with no migration, live database mutation, WhatsApp automation, or deployment. Because the HTTP calls aren't one transaction, directors should refresh before acting; transition RPCs are the authority. Automated CI cannot replace real individual director account acceptance tests.
