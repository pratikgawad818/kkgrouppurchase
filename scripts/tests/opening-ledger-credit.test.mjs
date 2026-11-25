import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {openingLedgerCredit} from "../../src/lib/opening-ledger-credit.ts";
const invoice=(patch={})=>({is_opening:true,net_payable:100000,opening_legacy_paid:0,opening_vendor_invoice_prior_payments:[],...patch});
test("only unpaid opening liability enters vendor ledger, with historical payments counted once",()=>{
 assert.deepEqual(openingLedgerCredit(invoice({opening_legacy_paid:10000,opening_vendor_invoice_prior_payments:[{amount:20000},{amount:5000}]})),{credit:65000,historicalPaid:35000});
 assert.equal(openingLedgerCredit(invoice({opening_legacy_paid:100000})).credit,0);
 assert.equal(openingLedgerCredit(invoice()).credit,100000);
});
test("regular invoices retain original net credit and ERP payments remain separate",()=>{
 assert.deepEqual(openingLedgerCredit(invoice({is_opening:false,opening_legacy_paid:10000})),{credit:100000,historicalPaid:0});
 assert.equal(openingLedgerCredit(invoice({opening_legacy_paid:20000})).credit-25000,55000);
});
test("paise arithmetic and invalid amounts fail closed",()=>{
 assert.deepEqual(openingLedgerCredit(invoice({net_payable:"100.03",opening_legacy_paid:"20.01",opening_vendor_invoice_prior_payments:[{amount:"30.02"}]})),{credit:50,historicalPaid:50.03});
 assert.throws(()=>openingLedgerCredit(invoice({opening_legacy_paid:100001})),/exceed/);
 assert.throws(()=>openingLedgerCredit(invoice({opening_legacy_paid:-1})),/verify/);
 assert.throws(()=>openingLedgerCredit(invoice({opening_vendor_invoice_prior_payments:[{amount:"NaN"}]})),/verify/);
});
test("ledger queries include historical details and only recorded ERP payments",()=>{
 const s=readFileSync("src/routes/_authenticated/_shell/finance.vendor-ledger.tsx","utf8");
 assert.ok(s.includes("loadLedgerInvoices(vendor)"));
 const api=readFileSync("src/lib/opening-payment-amendments.ts","utf8");
 assert.ok(api.includes("opening_vendor_invoice_prior_payments(id,amount)"));
 assert.ok(s.includes("!ids.has(p.id)"));
 assert.ok(s.includes("date:a.posting_date!"));
 assert.ok(s.includes("openingLedgerCredit({...x"));
 assert.ok(s.includes('eq("status", "recorded")'));
 assert.ok(s.includes("Pre-ERP paid"));
 assert.doesNotMatch(s,/\.insert\(|\.update\(|\.delete\(/);
});
