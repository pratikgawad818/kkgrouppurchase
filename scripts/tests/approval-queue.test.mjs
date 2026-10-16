import test from "node:test";
import assert from "node:assert/strict";
import { approvalPage, pendingApprovals, voteFetchChunks } from "../../src/lib/approval-queue.ts";

test("approval tabs isolate document types before counts and pagination", () => {
  const requests = Array.from({ length: 36 }, (_, i) => ({
    kind: i % 2 ? "vendor_payment" : "purchase_order", id: `request-${i}`,
  }));
  const orders = pendingApprovals(requests, "purchase_order");
  const payments = pendingApprovals(requests, "vendor_payment");
  assert.equal(orders.length, 18);
  assert.equal(payments.length, 18);
  assert.ok(orders.every(row => row.kind === "purchase_order"));
  assert.ok(payments.every(row => row.kind === "vendor_payment"));
  const last = approvalPage(payments, 1);
  assert.equal(last.total, 18);
  assert.deepEqual(last.items, payments.slice(15));
});

test("notification links match both type and ID without hiding the other queue", () => {
  const requests = [
    { kind: "purchase_order", id: "shared-id" },
    { kind: "vendor_payment", id: "shared-id" },
    { kind: "vendor_payment", id: "other-payment" },
  ];
  assert.deepEqual(pendingApprovals(requests, "vendor_payment", "shared-id"), [requests[1]]);
  assert.deepEqual(pendingApprovals(requests, "purchase_order", "completed"), []);
  assert.deepEqual(pendingApprovals(requests, "vendor_payment"), requests.slice(1));
  assert.deepEqual(pendingApprovals([], "purchase_order"), []);
});

test("empty approval queue does not query historical director votes", () => {
  assert.deepEqual(voteFetchChunks([]), []);
});

test("director votes are scoped to pending entity types and bounded ID groups", () => {
  const requests = [
    ...Array.from({ length: 121 }, (_, i) => ({ kind: "purchase_order", id: `po-${i}` })),
    { kind: "purchase_order", id: "po-0" },
    ...Array.from({ length: 19 }, (_, i) => ({ kind: "vendor_payment", id: `pay-${i}` })),
  ];
  const chunks = voteFetchChunks(requests);
  assert.deepEqual(chunks.map(b => [b.kind, b.ids.length]), [
    ["purchase_order", 50], ["purchase_order", 50], ["purchase_order", 21],
    ["vendor_payment", 19],
  ]);
  assert.equal(new Set(chunks.flatMap(b => b.ids)).size, 140);
  assert.ok(chunks.every(b => b.ids.length <= 50));
});

test("rejects invalid batching and malformed missing IDs", () => {
  for (const size of [0, -1, 101, 0.5, NaN]) {
    assert.throws(() => voteFetchChunks([], size), /batch size/);
  }
  assert.throws(() => voteFetchChunks([{ kind: "purchase_order", id: "" }]), /no document identifier/);
});

test("approval queue pagination keeps mobile pages bounded and clamps stale page after a decision", () => {
  const data = Array.from({ length: 52 }, (_, i) => `PO-${i}`);
  assert.deepEqual(approvalPage(data, 0), { items: data.slice(0, 15), page: 0, total: 52 });
  assert.deepEqual(approvalPage(data, 2), { items: data.slice(30, 45), page: 2, total: 52 });
  assert.deepEqual(approvalPage(data, 9), { items: data.slice(45), page: 3, total: 52 });
  assert.deepEqual(approvalPage([], 5), { items: [], page: 0, total: 0 });
  assert.equal(approvalPage(data, -1).page, 0);
  assert.equal(approvalPage(data, NaN).page, 0);
  assert.throws(() => approvalPage(data, 0, 0), /page size/);
});
