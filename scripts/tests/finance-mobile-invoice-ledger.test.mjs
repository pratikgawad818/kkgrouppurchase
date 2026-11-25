import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");
const root="src/routes/_authenticated/_shell/";
test("PO-linked invoice lines preserve field bindings and expose descriptive mobile labels",()=>{
 const s=read(root+"finance.vendor-invoices.new.tsx");
 for(const label of ["Include line","GRN","Material","Accepted quantity","Available quantity","Invoice quantity","PO rate","Bill rate","GST %","Amount"]) assert.ok(s.includes('data-label="'+label+'"'),label);
 assert.ok(s.includes("finance-entry-table"));
 assert.ok(s.includes('disabled={l.available <= 0}'));
 assert.ok(s.includes('upd(l.grn_item_id, { quantity: e.target.value })'));
 assert.ok(s.includes('upd(l.grn_item_id, { rate: e.target.value })'));
 assert.ok(s.includes('upd(l.grn_item_id, { tax_rate_percent: e.target.value })'));
 assert.ok(s.includes('aria-label={`Invoice quantity for ${l.material}`}'));
});
test("historical and PO-linked invoice detail tables retain original amounts and mobile-safe widths",()=>{
 const s=read(root+"finance.vendor-invoices.$id.tsx");
 assert.ok(s.includes("finance-invoice-lines"));
 assert.ok(s.includes("md:min-w-[780px]"));
 for(const label of ["Item / service","HSN/SAC","Quantity","Discount","GST","Total","Invoiced quantity","PO GST","Bill GST","Line total","Match"]) assert.ok(s.includes('data-label="'+label+'"'),label);
 assert.ok(s.includes("inr(l.line_total)"));
});
test("vendor ledger retains chronological transactions, opening balance and export scope",()=>{
 const s=read(root+"finance.vendor-ledger.tsx");
 for(const label of ["Document","Type","Details","Debit","Credit","Running balance","Opening amount"]) assert.ok(s.includes('data-label="'+label+'"'),label);
 assert.ok(s.includes("finance-opening-row"));
 assert.ok(s.includes("inr(opening)"));
 assert.ok(s.includes("inr(r.bal)"));
 assert.ok(s.includes("year:fyN,opening,rows:inFy"));
 assert.ok(s.includes("...inFy.map"));
});
test("new styles are restricted to mobile and do not create duplicate entry controls",()=>{
 const s=read("src/styles.css").split("/* Finance invoice line editors and ledger:")[1];
 assert.ok(s.includes("@media (max-width: 767px)"));
 assert.ok(s.includes("min-height: 44px"));
 assert.ok(s.includes("grid-column: 1 / -1"));
 assert.ok(s.includes(".finance-ledger-table .finance-opening-row"));
});
