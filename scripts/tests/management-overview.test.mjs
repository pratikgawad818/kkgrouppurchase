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
  assert.equal(VIEWER_NAV.has("/dashboard"), false);
  for (const forbidden of ["/approvals","/settings/users","/inventory/material-issues/new","/finance/vendor-invoices/new"]) {
    assert.equal(VIEWER_NAV.has(forbidden), false);
  }
});

test("historical material bills are counted once, pending separately, no stock or payment changes", () => {
  const base = {project_id:"site-A",status:"approved",is_opening:true,po_id:null,taxable:100,material_id:"m1",category:"Steel"};
  const historical = [
    {...base,id:"1",taxable:7000},
    {...base,id:"2",status:"pending_review",taxable:1200},
    {...base,id:"3",status:"paid",taxable:300},
    {...base,id:"4",status:"rejected",taxable:999},
    {...base,id:"5",status:"cancelled",taxable:999},
    {...base,id:"6",status:"draft",taxable:999},
    {...base,id:"7",po_id:"linked-po",taxable:999},
    {...base,id:"8",is_opening:false,taxable:999},
    {...base,id:"9",category:"Services",taxable:500},
    {...base,id:"10",material_id:null,category:null,taxable:250},
    {...base,id:"11",project_id:"site-B",taxable:200},
  ];
  const r=summarizeManagement([{warehouse_id:"s",quantity_on_hand:1,total_value:80}], [{project_id:"site-A",net_value:1000}], [{net_payable:10000,balance_due:200}], [{amount:100}], historical);
  assert.equal(r.stockValue,80);
  assert.equal(r.materialUsageCost,1000);
  assert.equal(r.recordedMaterialCost,9700);
  assert.deepEqual(r.historicalUsage,{approved:7500,pending:1200,services:500,unclassified:250});
  assert.deepEqual(r.historicalByProject.get("site-A"),{approved:7300,pending:1200,services:500,unclassified:250});
  assert.equal(r.unpaidSupplierBills,200);
  assert.equal(r.cashPaid,100);
  assert.throws(()=>summarizeManagement([],[],[],[],[historical[0],historical[0]]),/Duplicate historical/);
});
