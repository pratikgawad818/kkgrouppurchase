# Purchasing authority — current ERP policy

**Current behavior:** Based on the live PO security workflow installed in migration `0100`. Historic files such as `0046_director_created_purchasing.sql` describe earlier behavior; do not use them to authorize self-approval.

## Who can do what

| Role / origin | Purchase request (PR) | Purchase order (PO) |
| --- | --- | --- |
| Director | Can create and edit assigned drafts. The existing `pr_transition` flow may finalize the Director's own PR. | Can prepare a PO from an awarded quotation and **submit it for approval**. Cannot approve or reject a PO they created. |
| Super Admin | Uses the current permission-checked PR workflow. | Can prepare/submit an eligible PO; requires a different authorized Director's approval. |
| Purchase Manager or other authorized staff | Uses role/project-scoped create, submit and correction actions. | May prepare/submit an eligible PO; Director approval is required. |
| Independent Director | May review documents within their authorized company/project. | May approve or reject another person's pending PO, subject to active role, company membership, source/amount checks and audit rules. |

**Every newly submitted PO enters `pending_approval`.** A Director cannot bypass review by pressing “Finalize order,” repeatedly submitting an existing pending document, or directly setting the approval fields.

The `po_transition` RPC checks the actor, source chain, document status, independent signer and required fields. The `po_independent_approver_ck` constraint prevents `approved_by = created_by` even if a future code path attempts to do so. Director decisions and rejections are recorded in the approval audit history.

## Approval threshold

The currently installed workflow requires **one independent eligible Director** to approve a PO. A historical three-director quorum was part of an earlier migration and historical tests; it is **not** the current active PO threshold. If KK GROUP decides to require all three Director approvals, that is a separate policy and database change, not a documentation edit.

## Procurement chain and notifications

The source sequence remains **PR → RFQ → quotation → vendor selection → PO → delivery challan / GRN → invoice → payment**. No direct production PO bypass should be introduced.

The Director's PO mobile/in-app approval notice uses the **original PR requester's name** and the associated project (migration `0101`), not merely the employee who prepared the PO. Reminders use the same source.

### Safe change procedure

1. Verify the effective database function and permissions, rather than relying on a historical migration file or button label.
2. Rehearse approval, self-approval denial, role/company/project checks and source-document history against a disposable PostgreSQL database.
3. Make database changes via a new ordered migration with CI and an approved release. Never rewrite a migration that was applied to production.
4. Preserve existing PO records, approval events, invoice/stock ledgers and audit history. A GitHub merge and a Lovable publish are separate from applying SQL.
