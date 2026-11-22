import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { poInvoiceChargeGst } from "../../src/lib/po-invoice-extra-gst.ts";

const file=(p)=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const page=file("src/routes/_authenticated/_shell/finance.vendor-invoices.new.tsx");
const sql=file("drizzle/migrations/0108_vendor_invoice_po_extra_charge_gst.sql");

test("PO-2026-0004 pump booster Rs 20,000 + 18% GST adds Rs 3,600, not 45 CUM",()=>{
 const approved={freight_tax_type:"none",freight_tax_rate_percent:0,other_charges_tax_type:"cgst_sgst",other_charges_tax_rate_percent:18};
 assert.deepEqual(poInvoiceChargeGst(0,20000,approved),{freightGst:0,otherGst:3600,total:3600});
 assert.equal(292500+52650+20000+3600,368750);
 assert.deepEqual(poInvoiceChargeGst(0,0,approved),{freightGst:0,otherGst:0,total:0});
});

test("both CGST+SGST and IGST approved PO header types are supported",()=>{
 const withFreight={freight_tax_type:"igst",freight_tax_rate_percent:12,other_charges_tax_type:"cgst_sgst",other_charges_tax_rate_percent:18};
 assert.deepEqual(poInvoiceChargeGst(1000,20000,withFreight),{freightGst:120,otherGst:3600,total:3720});
 assert.deepEqual(poInvoiceChargeGst(0,20000,{...withFreight,other_charges_tax_type:"none"}),{freightGst:0,otherGst:0,total:0});
});

test("invoice preview uses PO tax settings and separates GST on other charges",()=>{
 assert.match(page,/freight_tax_type,freight_tax_rate_percent,other_charges_tax_type,other_charges_tax_rate_percent/);
 assert.match(page,/const extrasGst = poInvoiceChargeGst/);
 assert.match(page,/const total = toPaise\(sub\+tax\+extra\+extrasGst\.total\)/);
 assert.match(page,/GST on freight/);
 assert.match(page,/GST on other charges/);
 assert.match(page,/do not include GST inside these amount fields/);
});

test("server calculates header GST in payable/tax breakdown and removes extra GST from material match",()=>{
 assert.match(sql,/frtax := CASE WHEN po\.freight_tax_type/);
 assert.match(sql,/octax := CASE WHEN po\.other_charges_tax_type/);
 assert.match(sql,/taxsum := taxsum \+ frtax \+ octax/);
 assert.match(sql,/gt := sub \+ taxsum \+ fr \+ oc/);
 assert.match(sql,/c := c \+ round\(octax\/2,2\)/);
 assert.match(sql,/s := s \+ octax-round\(octax\/2,2\)/);
 assert.match(sql,/IF inv\.other_charges\+prior_other > po\.other_charges\+vt/);
 assert.match(sql,/IF inv\.freight\+prior_freight > po\.freight\+vt/);
 assert.match(sql,/inv\.subtotal \+ inv\.tax_total - frtax - octax/);
 assert.doesNotMatch(sql,/UPDATE purchase_orders SET|UPDATE goods_receipt_notes SET/);
});
