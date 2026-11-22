import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql=readFileSync("drizzle/migrations/0105_po_approval_notify_pr_engineer.sql","utf8");
const dispatch=readFileSync("src/routes/api/public/push-dispatch.ts","utf8");
const worker=readFileSync("public/push-sw.js","utf8");
const phone=readFileSync("src/components/erp/phone-alerts.tsx","utf8");

test("Director PO approval alerts the linked PR's originating Site Engineer",()=>{
  assert.match(sql,/NEW\.status IS DISTINCT FROM OLD\.status/);
  assert.match(sql,/NEW\.status='approved' AND NEW\.approved_by IS NOT NULL/);
  assert.match(sql,/requester\.id=pr\.requested_by/);
  assert.match(sql,/pr\.id=NEW\.purchase_request_id/);
  assert.match(sql,/pr\.company_id=NEW\.company_id/);
  assert.match(sql,/pr\.project_id=NEW\.project_id/);
  assert.match(sql,/public\.has_role\(requester\.id,'site_engineer'\)/);
  assert.match(sql,/public\.has_role\(approver\.id,'director'\)/);
  assert.match(sql,/public\.has_permission\(requester\.id,'purchase_order\.view'\)/);
  assert.match(sql,/public\.can_access_project\(requester\.id,NEW\.project_id\)/);
  assert.match(sql,/approver\.company_id=NEW\.company_id AND approver\.is_active/);
  assert.match(sql,/requester\.company_id=NEW\.company_id AND requester\.is_active/);
  assert.match(sql,/approver\.id=NEW\.approved_by/);
  assert.match(sql,/RETURNING user_id INTO engineer_notified/);
});

test("alert includes real approver name, PR, PO, project, supplier, and secured PO route",()=>{
  assert.match(sql,/approver\.full_name/);
  assert.match(sql,/approved PO/);
  assert.match(sql,/pr\.pr_number/);
  assert.match(sql,/NEW\.po_number/);
  assert.match(sql,/project\.name/);
  assert.match(sql,/vendor\.company_name/);
  assert.match(sql,/\/procurement\/purchase-orders\//);
  assert.match(sql,/INSERT INTO public\.notifications\(user_id,title,body,link\)/);
  assert.doesNotMatch(sql,/FROM public\.user_project_assignments[^;]*INSERT INTO public\.notifications/s);
});

test("Director reminders and PO preparer messages are preserved and duplicates avoided",()=>{
  assert.match(sql,/public\.notify_document_approvers\(/);
  assert.match(sql,/po_notification_context\(NEW\.id\)/);
  assert.match(sql,/NEW\.status IN \('approved','rejected'\)/);
  assert.match(sql,/public\.notify_document_creator\(/);
  assert.match(sql,/NEW\.created_by IS DISTINCT FROM engineer_notified/);
  assert.doesNotMatch(sql,/UPDATE\s+public\.purchase_orders/i);
  assert.doesNotMatch(sql,/UPDATE\s+director_approval_votes/i);
});

test("the same notification row supplies inbox and registered phone push, with explicit opt-in",()=>{
  assert.match(dispatch,/\.from\("notifications"\)/);
  assert.match(dispatch,/\.from\("push_subscriptions"\)/);
  assert.match(dispatch,/title: n\.title\.slice\(0, 150\)/);
  assert.match(dispatch,/body: \(n\.body \?\? ""\)\.slice\(0, 1000\)/);
  assert.match(worker,/registration\.showNotification/);
  assert.match(phone,/Turn on phone alerts/);
});
