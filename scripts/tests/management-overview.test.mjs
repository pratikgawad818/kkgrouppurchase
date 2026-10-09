import test from "node:test";
import assert from "node:assert/strict";
import { summarizeManagement, VIEWER_NAV } from "../../src/lib/management-overview.ts";

test("boss metrics distinguish stock, consumed cost, payable and money paid", () => {
  const result = summarizeManagement(
    [
      {warehouse_id: "store-1", quantity_on_hand: 20, total_value: 12000},
      {warehouse_id: "store-2", quantity_on_hand: 5, total_value: 5000},
      {warehouse_id: "store-1", quantity_on_hand: 1, total_value: 500},
    ],
    [{project_id: "site-A", net_value: 7000}, {project_id: "site-A", net_value: -500}, {project_id: "site-B", net_value: 2500}],
    [{net_payable: 12000, balance_due: 3000}, {net_payable: 8000, balance_due: 8000}],
    [{amount: 9000}, {amount: 1500}],
  );
  assert.deepEqual([result.stockValue, result.materialUsageCost, result.approvedSupplierBills, result.unpaidSupplierBills, result.cashPaid],
    [17500, 9000, 20000, 11000, 10500]);
  assert.equal(result.storeAmounts.get("store-1"), 12500);
  assert.equal(result.projectUsage.get("site-A"), 6500);
  assert.equal(result.projectUsage.get("site-B"), 2500);
  assert.notEqual(result.materialUsageCost, result.approvedSupplierBills);
});

test("a partial or invalid money value cannot silently make a reassuring summary", () => {
  assert.throws(() => summarizeManagement(
    [], [{ project_id:"one", net_value: Number.NaN }], [], []), /Invalid material consumption/);
  assert.throws(() => summarizeManagement(
    [{warehouse_id:"a",quantity_on_hand:1,total_value:"not-a-number"}], [], [], []), /Invalid inventory/);
  assert.deepEqual(summarizeManagement([],[],[],[]).storeAmounts.size,0);
});

test("management viewer links are read-only destinations, not admin or approval screens", () => {
  assert.ok(VIEWER_NAV.has("/management"));
  for (const forbidden of ["/approvals","/settings/users","/inventory/material-issues/new","/finance/vendor-invoices/new"]) {
    assert.equal(VIEWER_NAV.has(forbidden), false);
  }
});
