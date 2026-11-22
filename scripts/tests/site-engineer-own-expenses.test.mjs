import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canAccessPage } from "../../src/lib/page-access.ts";

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
  assert.match(ui, /queryKey:\["small-expenses",companyId,me\.data\?\.profile\.id,isSiteEngineer\]/);
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
  assert.match(ui, /isSiteEngineer&&!form\.projectId/);
});
