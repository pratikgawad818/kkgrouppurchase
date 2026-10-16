import test from "node:test";
import assert from "node:assert/strict";
import { APPROVAL_STATUS_FILTERS, approvalViewFor, approvalDetailsPath, isAwaitingApproval, mergeApprovalDecisions } from "../../src/lib/approval-history.ts";

const decision = (patch = {}) => ({ id: "vote-1", source: "vote", kind: "purchase_order", documentId: "po-1", actorId: "director-1", actorName: "Director One", decision: "approved", occurredAt: "2026-10-16T09:00:00Z", comment: null, ...patch });

test("approved history includes fulfilled orders and paid payments without mixing cancellation", () => {
  for (const state of ["approved", "sent", "partially_received", "partially_accepted", "fully_received", "short_closed", "closed"]) {
    assert.ok(APPROVAL_STATUS_FILTERS.approved.purchase_order.includes(state));
  }
  assert.deepEqual(APPROVAL_STATUS_FILTERS.approved.vendor_payment, ["approved", "recorded"]);
  assert.ok(!APPROVAL_STATUS_FILTERS.approved.vendor_payment.includes("cancelled"));
  assert.deepEqual(APPROVAL_STATUS_FILTERS.rejected.vendor_payment, []);
  assert.equal(approvalViewFor("vendor_payment", "rejected"), "cancelled");
  assert.equal(approvalViewFor("purchase_order", "rejected"), "rejected");
});

test("completed/rejected/cancelled records never qualify for approval actions", () => {
  for (const kind of ["purchase_order", "vendor_payment"]) {
    for (const status of ["approved", "recorded", "rejected", "cancelled", "sent", "closed", "draft"]) assert.equal(isAwaitingApproval(kind, status), false);
  }
  assert.equal(isAwaitingApproval("purchase_order", "pending_approval"), true);
  assert.equal(isAwaitingApproval("vendor_payment", "scheduled"), true);
  assert.equal(isAwaitingApproval("purchase_order", "scheduled"), false);
});

test("final vote and transition receipt merge once while preserving director identity and comment", () => {
  const rows = mergeApprovalDecisions([
    decision(),
    decision({ id: "event-1", source: "transition", occurredAt: "2026-10-16T14:30:00+05:30", actorName: null, comment: "Approved after review" }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actorName, "Director One");
  assert.equal(rows[0].source, "vote");
  assert.equal(rows[0].comment, "Approved after review");
});

test("separate directors, entity types and approval cycles remain separate and chronologically ordered", () => {
  const rows = mergeApprovalDecisions([
    decision({ id: "vote-later", occurredAt: "2026-10-17T09:00:00Z" }),
    decision({ id: "vote-payment", kind: "vendor_payment" }),
    decision({ id: "vote-director-2", actorId: "director-2", actorName: "Director Two" }),
    decision({ id: "vote-reject", decision: "rejected", comment: "Incorrect quantity" }),
    decision(),
  ]);
  assert.equal(rows.length, 5);
  assert.equal(rows.at(-1).id, "vote-later");
  assert.equal(rows.find(row => row.decision === "rejected").comment, "Incorrect quantity");
  assert.deepEqual(mergeApprovalDecisions([]), []);
  assert.throws(() => mergeApprovalDecisions([decision({ occurredAt: "not-a-date" })]), /invalid decision date/);
});

test("full details link identifies the exact order or payment", () => {
  assert.equal(approvalDetailsPath("purchase_order", "po-1"), "/procurement/purchase-orders/po-1");
  assert.equal(approvalDetailsPath("vendor_payment", "pay-2"), "/finance/payments/pay-2");
});
