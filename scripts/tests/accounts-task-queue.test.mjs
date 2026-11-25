import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read = p => readFileSync(p,"utf8");
const queue = read("src/components/erp/accounts-task-queue.tsx");
const dashboard = read("src/routes/_authenticated/_shell/dashboard.tsx");
const payments = read("src/routes/_authenticated/_shell/finance.payments.index.tsx");
const invoices = read("src/routes/_authenticated/_shell/finance.vendor-invoices.index.tsx");

test("daily Accounts tasks are scoped to the signed-in Accounts Manager and existing page permissions",()=>{
 assert.ok(queue.includes('access.roles.includes("accounts_manager")'));
 assert.ok(queue.includes('canAccessPage("/finance/vendor-invoices", access)'));
 assert.ok(queue.includes('canAccessPage("/finance/payments", access)'));
 assert.ok(queue.includes('enabled: !!userId && (canInvoices || canPayments)'));
 assert.ok(dashboard.includes('<AccountsTaskQueue access={access} userId={me.data?.profile.id'));
 assert.ok(queue.includes("All accessible projects"));
});

test("five queues use exact, RLS-filtered counts and fail visibly on incomplete data",()=>{
 for(const status of ["draft","exception","pending_review","scheduled","approved"]) {
   assert.ok(queue.includes('status: "'+status+'"'));
 }
 assert.equal(queue.split('count: "exact", head: true').length-1,2);
 assert.ok(queue.includes('count === null'));
 assert.ok(queue.includes('query.isError'));
 assert.ok(queue.includes('query.refetch()'));
 assert.doesNotMatch(queue,/\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});

test("task links open matching status-filtered registers without relaxing payment approval controls",()=>{
 assert.equal(queue.split('search={{ status: task.status }}').length-1,2);
 assert.ok(payments.includes('Object.prototype.hasOwnProperty.call(PAYMENT_STATUS'));
 assert.ok(invoices.includes('Object.prototype.hasOwnProperty.call(INVOICE_STATUS'));
 assert.ok(payments.includes('setStatus(sp.status ?? "")'));
 assert.ok(invoices.includes('status: sp.status ?? ""'));
 assert.ok(payments.includes('p.status === "approved" && can("payment.record")'));
 assert.ok(payments.includes('p.status === "scheduled" && can("payment.approve") && !mine'));
});
