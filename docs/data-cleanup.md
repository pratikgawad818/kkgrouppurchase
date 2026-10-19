# Super Admin data cleanup

Open **Settings → Data cleanup**. Only active Super Admins can enter this page or execute deletion, and deletion is limited to their company. Other staff cannot gain access merely by having a management permission.

The unused-record selector covers materials, vendors, projects, buildings, floors, available property units, warehouses, draft purchase requests, draft RFQs, draft purchase orders, draft vendor invoices and draft goods receipts. The database checks dependencies before the dialog accepts confirmation, and checks them again under locks when deleting. A visible draft or available status alone does not guarantee eligibility: actual submission/decision/status history and linked documents protect it. Creation-only metadata (and invoice draft edits) is copied to the immutable deletion snapshot before explicit removal, so a brand-new unused draft is deletable. Remove unused dependent records first where appropriate. Staff deletion stays in Users & roles, with existing self/Super Admin and linked-history restrictions.

Deletion requires typing **DELETE** for one named record. It retains the actor, timestamp, document snapshot and deleted draft-line snapshots in the immutable audit log. The audit filter includes `permanently_deleted`. No batch cleanup or ledger deletion is provided.

Linked operational records use the correction links on the same page: cancel a PO before receipt, cancel/reverse a GRN subject to stock/invoice checks, cancel an unapproved invoice or unrecorded payment, void a small expense, or record a material return. Existing workflow rules determine eligibility. Approved invoices and recorded bank movements cannot be erased by this feature.

Procurement save receipts remain after draft deletion. Retrying a deleted PR/RFQ save token fails clearly instead of returning a missing document or recreating it. Existing retry, stale-edit, company, approval and source-chain checks remain unchanged.

Migration `0047_super_admin_record_cleanup.sql` changes function definitions only; applying it deletes no business records and changes no role assignments. PostgreSQL CI exercises the real migration with disposable fixtures, including role/company denial, preflight without mutations, draft-line dependencies, audit snapshots and retry tombstones.
