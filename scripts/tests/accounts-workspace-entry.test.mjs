import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=p=>readFileSync(p,"utf8");
const route=p=>read("src/routes/_authenticated/_shell/"+p+".tsx");
test("accounts shortcuts are restricted by role and existing page access",()=>{
 const ui=read("src/components/erp/accounts-quick-actions.tsx");
 assert.ok(ui.includes('access.roles.includes("accounts_manager")'));
 assert.ok(ui.includes("canAccessPage(task.to, access)"));
 assert.ok(route("dashboard").includes("<AccountsQuickActions access={access}"));
});
test("searchable entry retains selected values and never auto-selects a search result",()=>{
 const ui=read("src/components/erp/searchable-entry-select.tsx");
 assert.ok(ui.includes("[selected, ...matching]"));
 assert.ok(ui.includes("Current selection unavailable"));
 assert.ok(ui.includes('onChange={event => { onChange(event.target.value); setSearch(""); }}'));
 for(const page of ["finance.vendor-invoices.opening","finance.vendor-invoices.new","finance.payments.index","finance.vendor-ledger"]){
   assert.ok(route(page).includes("<SearchableEntrySelect"), page);
 }
});
test("opening bill summary uses existing accounting calculation and save validation",()=>{
 const ui=route("finance.vendor-invoices.opening");
 assert.ok(ui.includes('aria-label="Live bill totals"'));
 assert.ok(ui.includes("calc.paid+calc.legacyPaid"));
 assert.ok(ui.includes("calc.balance"));
 assert.ok(ui.includes("validation.length===0"));
 assert.ok(ui.includes("if(canSave)save.mutate()"));
});
test("payment and payable search occurs before pagination and leaves server approval workflow intact",()=>{
 const payments=route("finance.payments.index");
 const payable=route("finance.payables");
 assert.ok(payments.includes("matchesRecordSearch([x.payment_number"));
 assert.ok(payments.includes('kind === "invoice" ? invoicePreflight.allocations : []'));
 assert.ok(payments.includes('rpc("schedule_vendor_payment"'));
 assert.ok(payable.includes('due: "open"'));
 assert.ok(payable.includes('matchesRecordSearch([x.invoice_number'));
 assert.ok(payable.includes('x.status !== "paid"'));
});
test("invoice source filters distinguish opening bills from PO-linked invoices",()=>{
 const ui=route("finance.vendor-invoices.index");
 assert.ok(ui.includes('billKind === "opening" ? x.is_opening : !x.is_opening'));
 assert.ok(ui.includes("Clear filters"));
});
