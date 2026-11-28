import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=p=>readFileSync(p,"utf8");
test("mobile dashboard uses compact filter and only shows editable custom dates when selected",()=>{
 const route=read("src/routes/_authenticated/_shell/sales-dashboard.tsx");
 assert.ok(route.includes('aria-label="Reporting period"'));
 assert.ok(route.includes('period==="custom"&&'));
 assert.ok(route.includes('SalesDashboardSummary report='));
 assert.ok(route.includes('No assigned projects'));
 assert.ok(route.includes('.eq("user_id",actor!)'));
});
test("project cards replace wide tables on phones and desktop unsold column matches data",()=>{
 const summary=read("src/components/erp/sales-dashboard-summary.tsx");
 assert.ok(summary.includes('data-mobile-project-cards'));
 assert.ok(summary.includes('md:hidden'));
 assert.ok(summary.includes('md:block'));
 assert.ok(summary.includes('inventory.projects.get(p.id)!.unsold'));
 assert.ok(summary.includes('stock.unsold'));
});
test("mobile charts remain within card bounds and allow month selection",()=>{
 const charts=read("src/components/erp/sales-dashboard-charts.tsx");
 assert.ok(charts.includes('data-mobile-trend'));
 assert.ok(charts.includes('sm:hidden'));
 assert.ok(charts.includes('setMonthChoice'));
 assert.ok(charts.includes('max-w-full overflow-x-auto sm:block'));
 const shell=read("src/components/erp/workspace-frame.tsx");
 assert.ok(shell.includes('if (home === "/sales-dashboard") return path === item.to'));
});
