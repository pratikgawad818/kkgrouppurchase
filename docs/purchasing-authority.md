# Purchasing authority

The source sequence remains purchase request → RFQ → awarded quotation → purchase order. There is no direct PO entry without an RFQ.

| Creator | Purchase request | Purchase order |
| --- | --- | --- |
| Director | Can create/edit a draft; Finalize request makes it Approved · Ready for RFQ immediately | Can create from the selected quotation; Finalize order approves it immediately |
| Super Admin | Existing purchase-request approval policy | Submit to Director; one independent active company Director approves |
| Other staff | Existing permissions and approval policy | Existing Director approval policy |

If an account has both Director and Super Admin roles, the Super Admin restriction takes precedence. A Director finalizing someone else's document does not gain the creator exception. For a Director's own draft or existing pending document, finalization validates the normal required fields and records an approval event, actor and timestamp; it is not an unrecorded approval bypass.

Already approved, cancelled or closed records are never retroactively changed. Payment approvals, receipt/stock posting and accounting remain unchanged. All decisions continue through pr_transition and po_transition, with existing company/project and active-user boundaries. No business transactions are created during production verification.

Migration 0046 grants the missing Director PR create/edit/submit permissions and replaces the two complete workflow functions. UI labels and history distinguish Finalized from Submitted for approval.
