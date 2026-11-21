import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const migration=readFileSync("drizzle/migrations/0101_po_requester_project_notifications.sql","utf8");
const push=readFileSync("src/routes/api/public/push-dispatch.ts","utf8");

test("PO approval mobile and inbox notifications identify original PR requester and project",()=>{
 assert.match(migration,/pr\.id=po\.purchase_request_id/);
 assert.match(migration,/requester\.id=pr\.requested_by/);
 assert.match(migration,/project\.id=po\.project_id/);
 assert.match(migration,/pr\.company_id=po\.company_id/);
 assert.match(migration,/pr\.project_id=po\.project_id/);
 assert.match(migration,/PO approval • /);
 assert.match(migration,/PO reminder • /);
 assert.match(migration,/Requested by/);
 assert.match(migration,/Prepared by/);
 assert.match(migration,/to_char\(coalesce\(NEW\.grand_total,0\)/);
 assert.match(migration,/REVOKE ALL ON FUNCTION public\.po_notification_context\(uuid\) FROM PUBLIC,anon,authenticated/);
});
test("PO notification deep links remain scoped to approvals and the push worker uses the same stored text",()=>{
 assert.match(migration,/\/approvals\?kind=purchase_order&id=/);
 assert.match(migration,/notify_document_approvers\(/);
 assert.match(push,/title: n\.title\.slice\(0, 150\)/);
 assert.match(push,/body: \(n\.body \?\? ""\)\.slice\(0, 1000\)/);
});
