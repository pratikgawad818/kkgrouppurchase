import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canAccessPage } from "../../src/lib/page-access.ts";
import { scopeSmallExpenseProjectOptions } from "../../src/lib/small-expense-project-scope.ts";

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const migration = read("drizzle/migrations/0104_site_engineer_own_small_expenses.sql");
const ui = read("src/routes/_authenticated/_shell/finance.small-expenses.tsx");

test("Site Engineers can navigate only to Small Expenses, not wider finance", () => {
  const site = { roles: ["site_engineer"], permissions: new Set([
    "small_expense.create", "purchase_request.view", "grn.view",
  ]) };
  assert.equal(canAccessPage("/finance/small-expenses",site),true);
  for (const path of [
    "/finance/vendor-invoices","/finance/payables","/finance/payments",
    "/finance/vendor-ledger","/reports/project-cost-control",
  ]) assert.equal(canAccessPage(path,site),false,path);
  for (const role of ["super_admin","director","accounts_manager"]) {
    assert.equal(canAccessPage("/finance/small-expenses",{
      roles:[role],permissions:new Set(["financial.view"]),
    }),true,role);
  }
});

test("new permission is narrow: no financial.view or editing granted to Site Engineers",()=>{
  assert.match(migration, /VALUES \('site_engineer','small_expense\.create'\)/);
  assert.doesNotMatch(migration, /VALUES \('site_engineer','financial\.view'\)/);
  assert.doesNotMatch(migration, /VALUES \('site_engineer','small_expense\.manage'\)/);
  assert.match(migration, /_project_id IS NULL THEN[\s\S]*?Select your assigned project/);
  assert.match(migration, /can_access_project\(auth\.uid\(\),p\.id\)/);
  assert.match(ui, /const canEdit=/);
  assert.match(ui, /const canCreate=canEdit \|\|/);
});

test("Site Engineers see own rows, own totals, own events and own bills only",()=>{
  assert.match(ui, /queryKey:\["small-expenses",companyId,me\.data\?\.profile\.id,isSiteEngineer,scopedSales\]/);
  assert.match(ui, /if \(isSiteEngineer\) query=query\.eq\("created_by",me\.data!\.profile\.id\)/);
  assert.match(ui, /const total=summarizeSmallExpenses\(rows\)/);
  assert.match(ui, /smallExpenseVendorSuggestions\(all\)/);
  for(const part of [
    'Site Engineers view own small expenses',
    'Site Engineers view own expense history',
    'Site Engineers view own expense bills',
  ])assert.ok(migration.includes(part),part);
  assert.match(migration, /created_by=auth\.uid\(\)/);
  assert.match(migration, /e\.created_by=auth\.uid\(\)/);
  assert.match(migration, /public\.can_view_site_small_expense_bill/);
});

test("bill uploads and management are restricted to the engineer's own record",()=>{
  assert.match(migration, /site_only AND \(\s*expense\.created_by IS DISTINCT FROM actor/);
  assert.match(migration, /site_only AND bill\.created_by IS DISTINCT FROM actor/);
  assert.match(migration, /storage\.foldername\(name\)\)\[2\] = auth\.uid\(\)::text/);
  assert.match(ui, /assignedOnly&&!form\.projectId/);
});

test("engineer expense project dropdown intersects explicit assignments (including buildings)",()=>{
  const projects=[
    {id:"city-centre",name:"City Centre"},
    {id:"kk-park",name:"KK Park"},
    {id:"central-hub",name:"Central Hub"},
  ];
  const buildings=[
    {id:"tower-a",project_id:"city-centre"},
    {id:"tower-b",project_id:"kk-park"},
    {id:"tower-c",project_id:"central-hub"},
    {id:"other",project_id:"unrelated"},
  ];
  const restricted=scopeSmallExpenseProjectOptions(projects,buildings,["kk-park"],true);
  assert.deepEqual(restricted.projects.map(x=>x.id),["kk-park"]);
  assert.deepEqual(restricted.buildings.map(x=>x.id),["tower-b"]);
  const twoSites=scopeSmallExpenseProjectOptions(projects,buildings,["kk-park","central-hub"],true);
  assert.deepEqual(twoSites.projects.map(x=>x.id),["kk-park","central-hub"]);
  assert.deepEqual(twoSites.buildings.map(x=>x.id),["tower-b","tower-c"]);
  const unassigned=scopeSmallExpenseProjectOptions(projects,buildings,[],true);
  assert.deepEqual(unassigned,{projects:[],buildings:[]});
  const manager=scopeSmallExpenseProjectOptions(projects,buildings,[],false);
  assert.deepEqual(manager.projects,projects);
  assert.deepEqual(manager.buildings.map(x=>x.id),["tower-a","tower-b","tower-c"]);
});

test("expense form requires explicit current-user project assignments and fails closed",()=>{
  assert.match(ui,/from\("user_project_assignments"\)/);
  assert.match(ui,/eq\("user_id",me\.data!\.profile\.id\)/);
  assert.match(ui,/if\(error\)throw error; \/\/ Fail closed/);
  assert.match(ui,/if\(!assignedIds\.length\)return \{projects:\[\],buildings:\[\]\};/);
  assert.match(ui,/projectQuery=projectQuery\.in\("id",assignedIds\)/);
  assert.match(ui,/buildingQuery=buildingQuery\.in\("project_id",assignedIds\)/);
  assert.match(ui,/scopeSmallExpenseProjectOptions\(projects\.data\?\?\[\],buildings\.data\?\?\[\],assignedIds,assignedOnly\)/);
  assert.match(ui,/if\(assignedOnly && !context\.data\?\.projects\.some/);
  assert.match(ui,/if\(form\.buildingId && !context\.data\?\.buildings\.some/);
  assert.match(ui,/No projects are assigned to your account/);
});
