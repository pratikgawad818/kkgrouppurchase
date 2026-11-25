import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {workspaceOrderCounts,workspacePayableRows,workspacePayableTotal} from "../../src/lib/workspace-kpis.ts";
test("open order and delivery counts match previous database filters, including null dates",()=>{
 const today="2026-11-25";
 const rows=[
 {status:"approved",expected_delivery_date:"2026-11-24"},
 {status:"sent",expected_delivery_date:today},
 {status:"partially_received",expected_delivery_date:null},
 {status:"partially_accepted",expected_delivery_date:"2026-11-26"},
 {status:"fully_received",expected_delivery_date:"2026-11-20"},
 {status:"draft",expected_delivery_date:today},
 {status:"cancelled",expected_delivery_date:today}
 ];
 assert.deepEqual(workspaceOrderCounts(rows,today),{open:4,due:2});
 assert.deepEqual(workspaceOrderCounts([],today),{open:0,due:0});
});
test("payable KPI counts approved and partially paid bills only",()=>{
 const rows=[{status:"approved",balance_due:"100.50"},{status:"partially_paid",balance_due:50.25},{status:"pending_review",balance_due:1000},{status:"paid",balance_due:0},{status:"rejected",balance_due:123}];
 assert.equal(workspacePayableTotal(workspacePayableRows(rows)),150.75);
 assert.equal(workspacePayableTotal([]),0);
 assert.throws(()=>workspacePayableTotal([{balance_due:NaN}]),/verified/);
});
test("dashboard reuses exact complete project scoped records without removing payable-only fallback or field role restrictions",()=>{
 const s=readFileSync("src/routes/_authenticated/_shell/dashboard.tsx","utf8");
 assert.ok(s.includes("workspaceOrderCounts(o, day)"));
 assert.ok(s.includes("canPayables && !canInvoices"));
 assert.ok(s.includes("canInvoices ? workspacePayableRows(inv) : outstanding"));
 assert.ok(s.includes('enabled: !!me.data?.profile.id'));
 assert.ok(s.includes('!isSiteEngineerPortal && can("/finance/vendor-invoices")'));
 assert.ok(s.includes('!isSiteEngineerPortal && can("/finance/payables")'));
 assert.ok(s.includes('query.eq("project_id", effectiveProject)'));
 assert.ok(s.includes("loadCompleteRows"));
 assert.ok(s.includes("buildPurchaseChains(chainInput)"));
 assert.doesNotMatch(s,/const openQuery =|const dueQuery =/);
});
