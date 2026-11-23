import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/migrations/0115_director_approval_notifications_only.sql", "utf8");
const bell = readFileSync("src/components/erp/notification-bell.tsx", "utf8");

test("one server-side Director notification gate runs BEFORE push delivery", () => {
  assert.match(sql, /CREATE TRIGGER director_approval_notification_only/);
  assert.match(sql, /BEFORE INSERT ON public\.notifications/);
  assert.match(sql, /r\.role = 'director'/);
  assert.match(sql, /RETURN NULL;/);
  assert.doesNotMatch(sql, /DELETE FROM public\.notifications|UPDATE public\.notifications/);
});

test("only pending PO and scheduled invoice-payment links are allowed", () => {
  assert.match(sql, /kind=purchase_order&id=/);
  assert.match(sql, /po\.status='pending_approval'/);
  assert.match(sql, /kind=vendor_payment&id=/);
  assert.match(sql, /payment\.status='scheduled'/);
  assert.match(sql, /payment\.kind='invoice'/);
  assert.match(sql, /po\.created_by IS DISTINCT FROM NEW\.user_id/);
  assert.match(sql, /payment\.created_by IS DISTINCT FROM NEW\.user_id/);
  assert.match(sql, /public\.has_permission\(NEW\.user_id,'purchase_order\.approve'\)/);
  assert.match(sql, /public\.has_permission\(NEW\.user_id,'payment\.approve'\)/);
  assert.match(sql, /public\.can_access_project\(NEW\.user_id,po\.project_id\)/);
});

test("other staff still see notifications and Directors see only appropriate archived links", () => {
  assert.match(sql, /IF NOT EXISTS \([\s\S]*?r\.role = 'director'[\s\S]*?RETURN NEW;/);
  assert.match(bell, /request\.like\("link", "\/approvals\?kind=%"\)/);
  assert.match(bell, /startsWith\("\/approvals\?kind=purchase_order&id="\)/);
  assert.match(bell, /startsWith\("\/approvals\?kind=vendor_payment&id="\)/);
  assert.match(bell, /"approvals-only"/);
});
