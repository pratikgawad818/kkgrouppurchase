import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const detail=readFileSync("src/routes/_authenticated/_shell/finance.vendor-invoices.$id.tsx","utf8");
const pay=readFileSync("src/routes/_authenticated/_shell/finance.payments.index.tsx","utf8");

test("approved opening and ordinary invoices expose a payment action only with unpaid balance and permission",()=>{
 assert.ok(detail.includes('["approved", "partially_paid"].includes(inv.status) && Number(inv.balance_due) > 0 && can("payment.schedule")'));
 assert.equal(detail.split('search={{ vendor: inv.vendor_id, invoice: inv.id }}').length-1,2);
 assert.ok(detail.includes("Add payment"));
});
test("invoice-specific payment retains exact invoice and vendor with no fallback to other bills",()=>{
 assert.ok(pay.includes('vendor?: string; invoice?: string'));
 assert.ok(pay.includes("!initialInvoice || x.id === initialInvoice"));
 assert.ok(pay.includes("inspectPaymentSchedule(alloc, invoiceRows,"));
 assert.ok(pay.includes("!initialInvoice || !!selectedInvoice"));
 assert.ok(pay.includes("disabled={!!initialInvoice}"));
 assert.ok(pay.includes("if (initialInvoice && !selectedInvoice) throw new Error"));
 assert.ok(pay.includes("project_id: selectedInvoice?.project_id ?? h.project_id"));
 assert.ok(pay.includes('schedule && can("payment.schedule")'));
});
test("new payments still use reservation checks and server approval workflow",()=>{
 assert.ok(pay.includes("availableAfterScheduled(Number(x.balance_due)"));
 assert.ok(pay.includes('rpc("schedule_vendor_payment"'));
 assert.ok(pay.includes('kind === "invoice" ? invoicePreflight.allocations : []'));
 assert.ok(pay.includes("Send for approval"));
 assert.ok(pay.includes('p.status === "approved" && can("payment.record")'));
 assert.ok(pay.includes("disabled={x.payable <= 0}"));
});
