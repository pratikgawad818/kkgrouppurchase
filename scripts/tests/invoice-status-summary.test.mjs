import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarizeInvoiceStatuses } from "../../src/lib/invoice-status-summary.ts";

test("unapproved, approved/paid, and combined gross invoice totals are independent and precise", () => {
  const result = summarizeInvoiceStatuses([
    { status: "pending_review", grand_total: "6377480.53" },
    { status: "approved", grand_total: "9232630.34" },
    { status: "paid", grand_total: "46452.00" },
    { status: "rejected", grand_total: "52038.00" },
  ]);
  assert.deepEqual(result.unapproved, { count: 1, paise: 637748053, total: 6377480.53 });
  assert.deepEqual(result.approved, { count: 2, paise: 927908234, total: 9279082.34 });
  assert.deepEqual(result.combined, { count: 3, paise: 1565656287, total: 15656562.87 });
  assert.deepEqual(result.excluded, { count: 1, paise: 5203800, total: 52038 });
});

test("drafts and exceptions are not falsely counted as approved; partially paid are counted as approved", () => {
  const result = summarizeInvoiceStatuses([
    { status: "draft", grand_total: "100.01" },
    { status: "exception", grand_total: "200.02" },
    { status: "partially_paid", grand_total: "300.03" },
    { status: "cancelled", grand_total: "400.04" },
  ]);
  assert.equal(result.unapproved.paise, 30003);
  assert.equal(result.approved.paise, 30003);
  assert.equal(result.combined.paise, 60006);
  assert.equal(result.excluded.paise, 40004);
});

test("empty register and a status-filtered register report truthful totals", () => {
  assert.equal(summarizeInvoiceStatuses([]).combined.count, 0);
  assert.equal(summarizeInvoiceStatuses([{status:"approved",grand_total:50}]).unapproved.total, 0);
});

test("missing, negative or unsafe monetary values are rejected rather than misreported", () => {
  assert.throws(() => summarizeInvoiceStatuses([{status:"approved",grand_total:"n/a"}]), /invalid invoice amount/);
  assert.throws(() => summarizeInvoiceStatuses([{status:"approved",grand_total:-1}]), /invalid invoice amount/);
  assert.throws(() => summarizeInvoiceStatuses([{status:"approved",grand_total:1e18}]), /invalid invoice amount/);
});

test("summary is visibly within the invoice listing and uses filtered rows, not just the current page",()=>{
  const page=readFileSync("src/routes/_authenticated/_shell/finance.vendor-invoices.index.tsx","utf8");
  assert.match(page,/summarizeInvoiceStatuses\(rows\)/);
  assert.match(page,/Invoice status totals/);
  assert.match(page,/Unapproved/);
  assert.match(page,/Approved \/ Paid/);
  assert.match(page,/Combined Total/);
  assert.match(page,/current search and/);
});
