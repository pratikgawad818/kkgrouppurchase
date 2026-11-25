import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");
const sql=read("drizzle/migrations/0118_reviewed_opening_payment_amendments.sql");
const ui=read("src/components/erp/opening-payment-amendments.tsx");
const ledger=read("src/routes/_authenticated/_shell/finance.vendor-ledger.tsx");
test("historical amendments require separate review and cannot directly create payments",()=>{
 assert.ok(sql.includes("req.requested_by=auth.uid()"));
 assert.ok(sql.includes("expected_invoice_updated_at"));
 assert.ok(sql.includes("REVOKE ALL ON public.opening_payment_amendments"));
 assert.ok(sql.includes("opening_payment_one_pending_per_bill"));
 assert.ok(sql.includes("opening_payment_unique_reference"));
 assert.ok(sql.includes("p.status IN ('scheduled','approved')"));
 assert.ok(sql.includes("public.financial_periods"));
 assert.ok(sql.includes("public.vi_refresh_balance(inv.id)"));
 assert.doesNotMatch(sql,/INSERT INTO public\.vendor_payments|UPDATE public\.vendor_payments|DELETE FROM public\.vendor_payments/i);
});
test("approval adjusts payable and opening clearing rather than cash, with actual posting date in ledger",()=>{
 assert.ok(sql.includes("jsonb_build_object('code','2100','debit',req.amount)"));
 assert.ok(sql.includes("jsonb_build_object('code','3000','credit',req.amount)"));
 assert.ok(sql.includes("prior_payment_id=pay_id,journal_entry_id=journal_id"));
 assert.ok(ledger.includes("!ids.has(p.id)"));
 assert.ok(ledger.includes("date:a.posting_date!"));
 assert.ok(ledger.includes("Reviewed opening liability adjustment — no bank payment"));
});
test("invoice UI separates historical corrections from new payments",()=>{
 assert.ok(ui.includes("Add missed historical payment"));
 assert.ok(ui.includes('r==="super_admin"||r==="accounts_manager"'));
 assert.ok(ui.includes("row.requested_by!==userId"));
 assert.ok(ui.includes("I independently verified the original proof"));
 assert.ok(ui.includes("Never use this to pay a supplier today"));
});
