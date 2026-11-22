import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canPermanentlyDeleteUnusedGrn } from "../../src/lib/grn-delete-eligibility.ts";

const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const sql=read("drizzle/migrations/0107_super_admin_delete_unused_grn.sql");
const list=read("src/routes/_authenticated/_shell/inventory.goods-received.index.tsx");
const detail=read("src/routes/_authenticated/_shell/inventory.goods-received.$id.tsx");
const button=read("src/components/erp/delete-unused-grn.tsx");

test("only active Super Admin sees delete on never-posted drafts or cancellations",()=>{
 assert.equal(canPermanentlyDeleteUnusedGrn(["super_admin"],true,"draft",null),true);
 assert.equal(canPermanentlyDeleteUnusedGrn(["super_admin"],true,"cancelled",null),true);
 assert.equal(canPermanentlyDeleteUnusedGrn(["super_admin"],true,"posted",null),false);
 assert.equal(canPermanentlyDeleteUnusedGrn(["super_admin"],true,"cancelled","2026-11-22T12:00:00Z"),false);
 assert.equal(canPermanentlyDeleteUnusedGrn(["super_admin"],false,"draft",null),false);
 for(const role of ["site_engineer","director","purchase_manager","accounts_manager"]){
   assert.equal(canPermanentlyDeleteUnusedGrn([role],true,"draft",null),false,role);
 }
});

test("SQL deletion requires active company-scoped Super Admin and unused GRN",()=>{
 for(const expr of [
  /public\.has_role\(auth\.uid\(\),'super_admin'\)/,
  /actor\.is_active/,
  /FOR UPDATE/,
  /receipt\.company_id IS DISTINCT FROM actor\.company_id/,
  /receipt\.status NOT IN \('draft','cancelled'\)/,
  /receipt\.posted_at IS NOT NULL/,
  /public\.inventory_transactions/,
  /public\.vendor_invoice_items/,
  /public\.journal_entries/,
  /grn_item_id IN/,
  /public\.log_event\(/,
  /jsonb_agg\(to_jsonb\(line\) ORDER BY line\.id\)/,
  /DELETE FROM public\.goods_receipt_items/,
  /DELETE FROM public\.goods_receipt_notes/,
 ]) assert.match(sql,expr);
 assert.doesNotMatch(sql,/UPDATE public\.(?:purchase_order_items|warehouse_stock|inventory_transactions|vendor_invoices|vendor_payments)/i);
});

test("Super Admin sees clear Delete GRN in list and detail, not force cascade",()=>{
 assert.match(list,/posted_at,received_by,po_id/);
 assert.match(list,/<DeleteUnusedGrnButton id=\{x\.id\}/);
 assert.match(detail,/<DeleteUnusedGrnButton id=\{g\.id\}/);
 assert.doesNotMatch(detail,/<PermanentDelete force kind="goods_receipt"/);
 assert.match(button,/Delete GRN/);
 assert.match(button,/Type DELETE to confirm/);
 assert.match(button,/Reason for deletion/);
 assert.match(button,/confirmation!=="DELETE"/);
 assert.match(button,/rpc\("super_admin_delete_unused_grn"/);
 assert.match(button,/qc\.invalidateQueries\(\{queryKey:\["grns"\]\}\)/);
});
