import test from "node:test";
import assert from "node:assert/strict";
import { approvalPage, voteFetchChunks } from "../../src/lib/approval-queue.ts";

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
