import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page=readFileSync("src/routes/_authenticated/_shell/finance.small-expenses.tsx","utf8");
const css=readFileSync("src/styles.css","utf8");

test("Site Engineer has a native, non-horizontal-scrolling mobile expenses register",()=>{
  assert.match(page,/isSiteEngineer&&<section aria-label="My expense records" className="mb-3 space-y-3 md:hidden"/);
  assert.match(page,/pageRows\.map\(x=>\s*<article key=\{x\.id\}/);
  assert.match(page,/onClick=\{\(\)=>setViewing\(x as SmallExpenseRecord\)\}/);
  assert.match(page,/doc-table hidden overflow-x-auto rounded-xl border bg-card shadow-card md:block/);
  assert.match(page,/isSiteEngineer\?"My Small Expenses":"Small Expenses"/);
  assert.match(page,/min-h-11 w-full justify-center/);
  assert.match(page,/\.order\("spent_on",\{ascending:false\}\)/);
  assert.match(page,/\.order\("created_at",\{ascending:false\}\)/);
});

test("Mobile expense filters are compact and still preserve vendor, date, category and project filters",()=>{
  assert.match(page,/aria-expanded=\{mobileFiltersOpen\}/);
  assert.match(page,/aria-controls="my-small-expense-filters"/);
  assert.match(page,/Search my expenses by vendor or payee/);
  assert.match(page,/setVendorFilter\(e\.target\.value\)/);
  assert.match(page,/categoryFilter/);
  assert.match(page,/dateFrom/);
  assert.match(page,/dateTo/);
  assert.match(page,/clearFilters/);
  assert.match(page,/Expense breakdown by category and project/);
  assert.match(page,/isSiteEngineer\?"All my projects":"All projects and office"/);
});

test("Engineer record dialog occupies the mobile viewport with independently scrollable form and sticky footer",()=>{
  assert.match(page,/site-expense-mobile-dialog max-h-\[90vh\]/);
  assert.match(page,/site-expense-form-header/);
  assert.match(page,/site-expense-form-body sm:contents/);
  assert.match(page,/site-expense-form-actions/);
  assert.match(page,/htmlFor="small-expense-project"/);
  assert.match(page,/htmlFor="small-expense-amount"/);
  assert.match(css,/\.site-expense-mobile-dialog\s*\{/);
  assert.match(css,/max-height: 100dvh !important/);
  assert.match(css,/\.site-expense-mobile-dialog \.site-expense-form-body\s*\{/);
  assert.match(css,/overflow-y: auto/);
  assert.match(css,/\.site-expense-mobile-dialog \.site-expense-form-actions\s*\{/);
  assert.match(css,/safe-area-inset-bottom/);
});

test("No expense ownership or project permissions changed when restyling",()=>{
  assert.match(page,/if \(isSiteEngineer\) query=query\.eq\("created_by",me\.data!\.profile\.id\)/);
  assert.match(page,/\.from\("user_project_assignments"\)/);
  assert.match(page,/\.eq\("user_id",me\.data!\.profile\.id\)/);
  assert.match(page,/if\(assignedOnly && !context\.data\?\.projects\.some\(/);
  assert.match(page,/public\.site_small_expenses|site_small_expenses/);
  assert.match(page,/const canEdit=/);
  assert.match(page,/const canCreate=canEdit \|\|/);
});
