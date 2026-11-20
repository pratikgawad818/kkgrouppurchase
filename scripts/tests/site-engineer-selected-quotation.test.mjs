import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/migrations/0086_selected_po_quotation_site_engineer.sql","utf8");
const po = readFileSync("src/routes/_authenticated/_shell/procurement.purchase-orders.$id.tsx","utf8");
const pr = readFileSync("src/routes/_authenticated/_shell/procurement.purchase-requests.$id.index.tsx","utf8");
const review = readFileSync("src/components/erp/po-review-actions.tsx","utf8");
const helper = readFileSync("src/lib/po-selected-quotation.ts","utf8");

test("selected quotation lookup is restricted to authorized PO, not all RFQ bids", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_po_selected_supplier_quotation/);
  assert.match(sql, /public\.has_permission\(actor,'purchase_order\.view'\)/);
  assert.match(sql, /public\.actor_in_company\(selected_po\.company_id\)/);
  assert.match(sql, /public\.can_access_project\(actor,selected_po\.project_id\)/);
  assert.match(sql, /q\.id=selected_po\.quotation_id/);
  assert.match(sql, /r\.company_id=selected_po\.company_id/);
  assert.match(sql, /r\.project_id=selected_po\.project_id/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_po_selected_supplier_quotation\(uuid\)/);
  assert.doesNotMatch(sql, /GRANT\s+SELECT\s+ON\s+public\.vendor_quotations/i);
});

test("selected PDF storage access is limited by quote ID and viewable PO", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.can_read_procurement_attachment/);
  assert.match(sql, /JOIN public\.vendor_quotations qt ON qt\.id=po\.quotation_id/);
  assert.match(sql, /qt\.attachment_path=_path/);
  assert.match(sql, /public\.has_permission\(auth\.uid\(\),'purchase_order\.view'\)/);
  assert.match(sql, /public\.can_access_project\(auth\.uid\(\),po\.project_id\)/);
  assert.match(sql, /public\.has_permission\(auth\.uid\(\),'quotation\.view'\)/,
    "Normal RFQ vendor quotes remain protected by their existing permission");
});

test("PO View Quotation and quotation reference use RLS-safe metadata", () => {
  assert.match(helper,/get_po_selected_supplier_quotation/);
  assert.match(po,/fetchSelectedPoQuotation\(id\)/);
  assert.match(po,/quotePath=\{selectedQuotation\?\.attachment_path/);
  assert.match(po,/label="Quotation" value=\{selectedQuotation\?\.quotation_number/);
  assert.match(review,/fetchSelectedPoQuotation\(poId\)/);
  assert.match(review,/vendor_quotations: \{/);
});

test("Site Engineer PR makes selected quotation visible before long request details", () => {
  const position=pr.indexOf("Supplier quotation — linked to your purchase request");
  assert.ok(position>0);
  assert.ok(position<pr.indexOf("Request information"));
  assert.match(pr,/get_pr_selected_supplier_quotes/);
  assert.match(pr,/label="View quotation"/);
  assert.match(pr,/refetchOnMount: "always"/);
});
