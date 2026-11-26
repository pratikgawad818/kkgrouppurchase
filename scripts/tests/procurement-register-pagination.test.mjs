import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCompleteRows } from "../../src/lib/complete-register.ts";
const route = name => readFileSync("src/routes/_authenticated/_shell/" + name + ".tsx", "utf8");

test("eligible selectors can return more than 500 rows without silent truncation", async () => {
  const rows = Array.from({ length: 751 }, (_, i) => ({ id: String(i) }));
  const actual = await loadCompleteRows(async (start, end) => ({
    data: rows.slice(start, end + 1), count: rows.length, error: null,
  }));
  assert.deepEqual(actual, rows);
});
test("challan and RFQ selectors retain scope and count-checked paging", () => {
  const challans = route("inventory.delivery-challans.index");
  assert.doesNotMatch(challans, /\.limit\(500\)/);
  assert.ok(challans.includes('query.in("project_id", scope.assignedProjectIds)'));
  assert.ok(challans.includes('!pos.isSuccess || pos.isFetching'));
  const rfq = route("procurement.rfqs.new");
  assert.doesNotMatch(rfq, /\.limit\(500\)/);
  assert.equal((rfq.match(/loadCompleteRows\(async/g) ?? []).length, 2);
  assert.ok(rfq.includes('.eq("status", "approved")'));
  assert.ok(rfq.includes('.eq("status", "active")'));
});
test("quotation register uses bounded server pages and exact count", () => {
  const quotes = route("procurement.vendor-quotations");
  assert.ok(quotes.includes('queryKey: ["quotations", page]'));
  assert.ok(quotes.includes('count: "exact"'));
  assert.ok(quotes.includes('.order("id", { ascending: false }).range(start, start + PAGE - 1)'));
  assert.ok(quotes.includes('data.length !== Math.min(PAGE, Math.max(0, count - start))'));
  assert.ok(quotes.includes('<Pager page={page} total={q.data!.total}'));
  assert.doesNotMatch(quotes, /\.limit\(500\)/);
});
