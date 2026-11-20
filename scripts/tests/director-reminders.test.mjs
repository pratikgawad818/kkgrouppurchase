import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("pending PO detail offers a director reminder to Super Admin", () => {
  const page = source("src/routes/_authenticated/_shell/procurement.purchase-orders.$id.tsx");
  assert.match(page, /po\.status === "pending_approval"[\s\S]{0,150}isAdmin/);
  assert.match(page, /<DirectorApprovalReminder id=\{id\} kind="purchase_order"/);
});

test("Super Admin has reminder actions for pending POs and payments in the approvals queue", () => {
  const page = source("src/routes/_authenticated/_shell/approvals.tsx");
  assert.match(page, /isSuperAdmin && waiting && directors\.length > 0/);
  assert.match(page, /<DirectorApprovalReminder id=\{r\.id\} kind=\{r\.kind\}/);
  assert.match(page, /history\.isSuccess/);
});

test("scheduled payment detail offers a reminder only to Super Admin", () => {
  const page = source("src/routes/_authenticated/_shell/finance.payments.$id.tsx");
  assert.match(page, /p\.status === "scheduled"/);
  assert.match(page, /me\.data\?\.roles\.includes\("super_admin"\)/);
  assert.match(page, /<DirectorApprovalReminder id=\{id\} kind="vendor_payment"/);
});

test("reminder component sends a single RPC and disables repeat taps during request", () => {
  const component = source("src/components/erp/director-approval-reminder.tsx");
  assert.match(component, /supabase\.rpc\("remind_po_approvers"/);
  assert.match(component, /supabase\.rpc\("remind_payment_approvers"/);
  assert.match(component, /disabled=\{disabled \|\| reminder\.isPending\}/);
});

test("payment reminder RPC is admin-only, company-scoped and cannot approve payments", () => {
  const sql = source("drizzle/migrations/0087_super_admin_director_reminders.sql");
  assert.match(sql, /role = 'super_admin'/);
  assert.match(sql, /actor_in_company\(p\.company_id\)/);
  assert.match(sql, /p\.status <> 'scheduled'/);
  assert.match(sql, /notify_document_approvers\(/);
  assert.match(sql, /payment_approval_reminder_sent/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.vendor_payments/i);
});
