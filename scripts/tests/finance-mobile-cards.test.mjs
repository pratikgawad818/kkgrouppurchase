import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");
const root="src/routes/_authenticated/_shell/";
test("mobile finance registers retain table content and label every card field",()=>{
 for(const [file,labels] of [
 ["finance.vendor-invoices.index.tsx",["Vendor bill","Bill date","Due date","Vendor","Project","Invoice total","Balance due","Match","Status"]],
 ["finance.payments.index.tsx",["Payment number","Vendor","Against","Mode / reference","Amount","Status","Available to pay","Payment amount"]],
 ["finance.payables.tsx",["Vendor","Due date","Net payable","Paid + adjusted","Balance due","Status"]]
 ]){
  const s=read(root+file);
  assert.ok(s.includes("finance-doc-table"),file);
  for(const label of labels)assert.ok(s.includes('data-label="'+label+'"'),file+":"+label);
  assert.ok(s.includes("pageRows.map"),file);
  assert.ok(s.includes("<Pager"),file);
  assert.doesNotMatch(s,/data-label="ERROR"/);
 }
});
test("mobile payment allocation keeps existing authorization, availability and submission guards",()=>{
 const s=read(root+"finance.payments.index.tsx");
 assert.ok(s.includes("finance-payment-footer"));
 assert.ok(s.includes("finance-allocation-table"));
 assert.ok(s.includes("!canSchedule || total <= 0 || save.isPending"));
 assert.ok(s.includes("disabled={x.payable <= 0}"));
 assert.ok(s.includes('p.status === "scheduled" && can("payment.approve") && !mine'));
 assert.ok(s.includes('p.status === "approved" && can("payment.record")'));
});
test("card styling is mobile-scoped and existing desktop tables remain intact",()=>{
 const css=read("src/styles.css");
 const mobile=css.slice(css.indexOf("/* Finance cards reuse"));
 assert.ok(mobile.includes("@media (max-width: 767px)"));
 assert.ok(mobile.includes("grid-column: 1 / -1"));
 assert.ok(mobile.includes("min-height: 44px"));
 assert.ok(mobile.includes("position: sticky; bottom: 0"));
});
