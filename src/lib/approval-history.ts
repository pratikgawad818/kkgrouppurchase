import type { ApprovalKind } from "./approval-queue.ts";

export type ApprovalView = "pending" | "approved" | "rejected" | "cancelled";
export const APPROVAL_STATUS_FILTERS = {
  pending: { purchase_order: ["pending_approval"], vendor_payment: ["scheduled"] },
  approved: { purchase_order: ["approved", "sent", "partially_received", "partially_accepted", "fully_received", "short_closed", "closed"], vendor_payment: ["approved", "recorded"] },
  rejected: { purchase_order: ["rejected"], vendor_payment: [] },
  cancelled: { purchase_order: ["cancelled"], vendor_payment: ["cancelled"] },
} as const;

export function approvalViewFor(kind: ApprovalKind, view: ApprovalView): ApprovalView {
  return kind === "vendor_payment" && view === "rejected" ? "cancelled" : view;
}

export function isAwaitingApproval(kind: ApprovalKind, status: string): boolean {
  return status === (kind === "purchase_order" ? "pending_approval" : "scheduled");
}

export function approvalDetailsPath(kind: ApprovalKind, id: string): string {
  return kind === "purchase_order" ? `/procurement/purchase-orders/${id}` : `/finance/payments/${id}`;
}

export type ApprovalDecision = {
  id: string;
  source: "vote" | "transition" | "record";
  kind: ApprovalKind;
  documentId: string;
  actorId: string | null;
  actorName: string | null;
  decision: "approved" | "rejected" | "cancelled";
  occurredAt: string;
  comment: string | null;
};

/** The final vote may also appear in the transition ledger at the same instant. */
export function mergeApprovalDecisions(rows: ReadonlyArray<ApprovalDecision>): ApprovalDecision[] {
  const unique = new Map<string, ApprovalDecision>();
  for (const row of rows) {
    const time = Date.parse(row.occurredAt);
    if (!Number.isFinite(time)) throw new Error("Approval history contains an invalid decision date.");
    const key = JSON.stringify([row.kind, row.documentId, row.actorId ?? row.id, row.decision, time]);
    const existing = unique.get(key);
    unique.set(key, existing ? { ...existing, actorName: existing.actorName || row.actorName, comment: existing.comment || row.comment } : row);
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id.localeCompare(b.id));
}
