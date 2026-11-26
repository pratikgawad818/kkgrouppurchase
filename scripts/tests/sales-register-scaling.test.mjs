import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=readFileSync("src/components/erp/sales-register.tsx","utf8");
test("candidate searches are scoped before applying their URL safety cap",()=>{
  assert.ok(source.includes('candidates.eq("project_id",filter.project)'));
  assert.ok(source.includes('candidates.eq("building_id",filter.building)'));
  assert.ok(source.includes('candidates.eq("floor_id",filter.floor)'));
  assert.ok(source.includes('candidates.eq("units.building_id",filter.building)'));
  assert.ok(source.includes('candidates.eq("units.floor_id",filter.floor)'));
  assert.ok(source.includes('units.data.length!==units.count'));
  assert.ok(source.includes('sales.data.length!==sales.count'));
  assert.ok(source.includes('setSettledSearch(search),250'));
  assert.ok(source.includes('searchReady=search===settledSearch'));
});
test("sales register and activity history require exact counted pages",()=>{
  assert.ok(source.includes('result.data.length!==Math.min(PAGE_SIZE,Math.max(0,result.count-filter.page*PAGE_SIZE))'));
  assert.ok(source.includes('queryKey:["sales-events",sale?.id,historyPage,me.data?.profile.id]'));
  assert.ok(source.includes('.range(start,start+PAGE_SIZE-1)'));
  assert.ok(source.includes('result.data.length!==Math.min(PAGE_SIZE,Math.max(0,result.count-start))'));
  assert.ok(source.includes('setHistoryPage(0)'));
  assert.doesNotMatch(source,/\.limit\(150\)/);
});
test("sales actions cannot rely on missing finance balances",()=>{
  assert.ok(source.includes('rows.length!==salesIds.length'));
  assert.ok(source.includes('salesIds.some(id=>!rows.some(row=>row.sale_id===id))'));
  assert.ok(source.includes('&&financeReady'));
  assert.ok(source.includes('summary.isSuccess ? value : "—"'));
});
