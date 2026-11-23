import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/migrations/0102_pr_manager_received_notification.sql","utf8");
const pr = readFileSync("src/lib/pr.ts","utf8");
const current = readFileSync("drizzle/migrations/0111_pr_requester_stage_notifications.sql","utf8");
const flow = readFileSync("src/lib/workflow-progress.ts","utf8");
const po = readFileSync("src/lib/workflow-progress.ts","utf8");

test("PR received for procurement wording preserves internal approved status",()=>{
 assert.match(sql,/NEW\.status='approved'/);
 assert.match(sql,/public\.has_role\(NEW\.approved_by,'purchase_manager'\)/);
 assert.match(sql,/Purchase Manager received your request/);
 assert.match(sql,/Your purchase request was accepted for procurement/);
 assert.match(sql,/notify_document_creator/);
 assert.doesNotMatch(sql,/UPDATE purchase_requests|UPDATE purchase_orders|UPDATE vendor_payments/);
 assert.match(pr,/PR received for procurement · RFQ ready/);
 assert.match(pr,/approved: "PR received for procurement"/);
 assert.match(current,/PR received for procurement by/);
 assert.doesNotMatch(current,/Your purchase request was accepted for procurement/);
 assert.match(current,/NEW\.status='approved'/);
 assert.match(flow,/Purchase Manager review/);
});
test("Director PO approval remains separate and unchanged",()=>{
 assert.match(po,/stateLabel: "Awaiting Director approval"/);
 assert.match(po,/stateLabel: "Approved by Director"/);
 assert.match(po,/Purchase Order approved/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.notify_on_pr_status\(\) FROM PUBLIC,anon,authenticated/);
});
