import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canCancelDraftGrn } from "../../src/lib/grn-draft-cancellation.ts";

const source = path => readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const sql = source("drizzle/migrations/0106_cancel_draft_grn_site_engineer_admin.sql");
const list = source("src/routes/_authenticated/_shell/inventory.goods-received.index.tsx");
const detail = source("src/routes/_authenticated/_shell/inventory.goods-received.$id.tsx");
const component = source("src/components/erp/cancel-draft-grn.tsx");

test("Only the engineer who created a draft or Super Admin sees Cancel Draft",()=>{
 const args={status:"draft",receivedBy:"engineer-one",viewerId:"engineer-one",roles:["site_engineer"],canCreate:true};
 assert.equal(canCancelDraftGrn(args),true);
 assert.equal(canCancelDraftGrn({...args,viewerId:"engineer-two"}),false);
 assert.equal(canCancelDraftGrn({...args,viewerId:"engineer-two",roles:["super_admin"]}),true);
 assert.equal(canCancelDraftGrn({...args,status:"posted"}),false);
 assert.equal(canCancelDraftGrn({...args,status:"cancelled"}),false);
 assert.equal(canCancelDraftGrn({...args,roles:["director"]}),false);
 assert.equal(canCancelDraftGrn({...args,roles:["purchase_manager"]}),false);
 assert.equal(canCancelDraftGrn({...args,canCreate:false}),false);
 assert.equal(canCancelDraftGrn({...args,viewerId:null}),false);
});

test("Dedicated RPC never grants engineers power to reverse posted GRNs",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.cancel_draft_goods_receipt/);
 assert.match(sql,/g\.status <> 'draft'/);
 assert.match(sql,/g\.received_by IS DISTINCT FROM auth\.uid\(\)/);
 assert.match(sql,/public\.has_role\(auth\.uid\(\),'site_engineer'\)/);
 assert.match(sql,/public\.has_role\(auth\.uid\(\),'super_admin'\)/);
 assert.match(sql,/public\.is_active_user\(auth\.uid\(\)\)/);
 assert.match(sql,/public\.actor_in_company\(g\.company_id\)/);
 assert.match(sql,/public\.can_access_project\(auth\.uid\(\),g\.project_id\)/);
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/g\.posted_at IS NOT NULL/);
 assert.match(sql,/public\.inventory_transactions/);
 assert.match(sql,/public\.vendor_invoice_items/);
 assert.match(sql,/UPDATE public\.goods_receipt_notes/);
 assert.match(sql,/public\.log_event\(/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.cancel_draft_goods_receipt/);
 assert.doesNotMatch(sql,/INSERT INTO public\.inventory_transactions|UPDATE public\.purchase_order_items|post_stock_x|grn_apply|GRANT.*grn\.cancel/);
});

test("Both register and detail provide cancellation, with confirmation and reason",()=>{
 assert.match(list,/received_by,po_id,project_id/);
 assert.match(list,/<CancelDraftGrnButton id=\{x\.id\}/);
 assert.match(detail,/<CancelDraftGrnButton id=\{g\.id\}/);
 assert.match(component,/Cancel draft/);
 assert.match(component,/Cancel draft \{number\}/);
 assert.match(component,/Cancellation reason \*/);
 assert.match(component,/Confirm cancellation/);
 assert.match(component,/Keep draft/);
 assert.match(component,/rpc\("cancel_draft_goods_receipt"/);
 assert.match(component,/qc\.invalidateQueries\(\{ queryKey: \["grns"\] \}\)/);
 assert.match(component,/qc\.invalidateQueries\(\{ queryKey: \["po"\] \}\)/);
});
