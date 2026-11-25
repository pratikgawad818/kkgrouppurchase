import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");
const sql=read("drizzle/migrations/0119_hold_pending_opening_payment_corrections.sql");
const queue=read("src/components/erp/opening-payment-review-queue.tsx");
const pay=read("src/routes/_authenticated/_shell/finance.payments.index.tsx");
const bill=read("src/routes/_authenticated/_shell/finance.vendor-invoices.$id.tsx");
test("pending historical corrections block both ordinary allocations and advance adjustments at database boundary",()=>{
 assert.ok(sql.includes("FOR UPDATE"));
 assert.ok(sql.includes("status='pending'"));
 assert.ok(sql.includes("ON public.vendor_payment_allocations"));
 assert.ok(sql.includes("ON public.vendor_advance_adjustments"));
 assert.ok(sql.includes("REVOKE ALL ON FUNCTION"));
 assert.doesNotMatch(sql,/DELETE FROM|UPDATE public\.vendor_invoices SET/);
});
test("pending review queue distinguishes requests from independent reviewer tasks and stays scoped",()=>{
 assert.ok(queue.includes('r==="super_admin"||r==="accounts_manager"'));
 assert.ok(queue.includes("r.requested_by!==userId"));
 assert.ok(queue.includes("loadPendingOpeningAmendments()"));
 assert.ok(queue.includes('to="/finance/vendor-invoices/$id"'));
 assert.ok(read("src/routes/_authenticated/_shell/dashboard.tsx").includes("<OpeningPaymentReviewQueue compact />"));
 assert.ok(read("src/routes/_authenticated/_shell/finance.vendor-invoices.index.tsx").includes("<OpeningPaymentReviewQueue />"));
});
test("held invoices are visibly unavailable for settlement and failed hold lookup fails closed",()=>{
 assert.ok(pay.includes("loadPendingOpeningAmendments(vendor)"));
 assert.ok(pay.includes("payable: correctionHeld?0:payable"));
 assert.ok(pay.includes("Historical correction hold"));
 assert.ok(bill.includes("hold.isSuccess&&!hold.isFetching&&!pendingCorrection"));
 assert.ok(bill.includes("Payment on hold"));
});
