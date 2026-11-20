import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const form = read("src/components/erp/pr-form.tsx");
const detail = read("src/routes/_authenticated/_shell/procurement.purchase-requests.$id.index.tsx");
const recovery = read("src/components/erp/pr-missing-attachment.tsx");
const sql = read("drizzle/migrations/0089_fix_pr_first_attachment_pending.sql");

test("new PR is kept in draft until its newly uploaded attachment is linked", () => {
  assert.match(form, /_submit: submit && !attachment/);
  const linkAt = form.indexOf('supabase.rpc("set_purchase_request_attachment"');
  const transitionAt = form.indexOf('supabase.rpc("pr_transition"');
  assert.ok(linkAt >= 0 && transitionAt > linkAt, "Attach before submitting the PR");
  assert.match(form, /_action: "submitted"/);
  assert.match(form, /The purchase request is saved as a draft and has NOT been sent for approval/);
  assert.doesNotMatch(form, /Purchase Request saved, but attaching the quotation failed/);
  assert.match(form, /\["pending_approval", "approved"\]\.includes/);
});

test("legacy PR attachment RPC can recover the first document on pending PR", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.set_purchase_request_attachment/);
  assert.match(sql, /public\.is_active_user\(actor\)/);
  assert.match(sql, /public\.has_permission\(actor, 'purchase_request\.edit'\)/);
  assert.match(sql, /request\.requested_by IS DISTINCT FROM actor/);
  assert.match(sql, /public\.actor_in_company\(request\.company_id\)/);
  assert.match(sql, /public\.can_access_project\(actor, request\.project_id\)/);
  assert.match(sql, /request\.status NOT IN \('draft', 'pending_approval'\)/);
  assert.match(sql, /request\.status='pending_approval' AND request\.attachment_path IS NOT NULL/);
  assert.match(sql, /public\.procurement_attachment_owned\(_path, request\.company_id, actor\)/);
  assert.match(sql, /set_config\('app\.pr_source', 'rpc', true\)/);
  assert.match(sql, /UPDATE public\.purchase_requests SET attachment_path=_path WHERE id=_id/);
  assert.match(sql, /set_config\('app\.pr_source', coalesce\(previous_source, ''\), true\)/);
  assert.doesNotMatch(sql, /UPDATE public\.purchase_requests SET status=/i);
});

test("pending requester can attach missing document to the SAME PR", () => {
  assert.match(detail, /!pr\.attachment_path && pending && mine && can\("purchase_request\.edit"\)/);
  assert.match(detail, /<PrMissingAttachment/);
  assert.match(recovery, /uploadProcurementAttachment\(file, companyId, actorId\)/);
  assert.match(recovery, /_id: prId,/);
  assert.match(recovery, /set_purchase_request_attachment/);
  assert.doesNotMatch(recovery, /save_purchase_request\(/);
});
