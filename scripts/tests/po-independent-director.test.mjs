import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const sql=readFileSync("drizzle/migrations/0100_po_director_independent_approval.sql","utf8");
const po=readFileSync("src/routes/_authenticated/_shell/procurement.purchase-orders.$id.tsx","utf8");
const acceptance=readFileSync("scripts/db/test_go_live_hardening.py","utf8");

test("director-origin PO submission cannot promote directly to approved",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.po_transition/);
 assert.match(sql,/nxt := 'pending_approval'::po_status;/);
 assert.match(sql,/IF p.status NOT IN \('draft','rejected'\) THEN/);
 assert.doesNotMatch(sql,/director_origin|Finalized by the creating Director/);
 assert.match(sql,/IF p.created_by = auth\.uid\(\) THEN RAISE EXCEPTION 'You cannot approve or reject a PO you created'/);
 assert.match(sql,/register_director_vote\('purchase_order'/);
 assert.match(sql,/INSERT INTO purchase_order_approvals\(po_id, action, acted_by, comment, previous_status, new_status\)/);
 assert.match(sql,/po_independent_approver_ck/);
 assert.match(sql,/approved_by IS NULL OR approved_by IS DISTINCT FROM created_by/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.po_transition/);
});

test("PO detail UI never offers a self-finalize bypass",()=>{
 assert.doesNotMatch(po,/directorCanFinalizeOwnPurchasing|finalizeOwn|Finalize order/);
 assert.match(po,/\{draft && can\("purchase_order\.create"\)/);
 assert.match(po,/Submit for approval/);
 assert.match(po,/isDirector && can\("purchase_order\.approve"\) && !mine/);
});

test("disposable PG tests check creator cannot approve or resubmit pending PO",()=>{
 assert.match(acceptance,/Director submitted for independent review/);
 assert.match(acceptance,/denied\(c,lambda:c\.execute\("SELECT po_transition\(%s,'approved','self'\)"/);
 assert.match(acceptance,/Independent director reviewed/);
 assert.match(acceptance,/Finalize my existing order/);
});
