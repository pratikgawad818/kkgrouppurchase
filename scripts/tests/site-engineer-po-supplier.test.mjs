import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const sql = read("drizzle/migrations/0088_po_supplier_identity_site_engineer.sql");
const helper = read("src/lib/po-supplier-document.ts");
const review = read("src/components/erp/po-review-actions.tsx");
const detail = read("src/routes/_authenticated/_shell/procurement.purchase-orders.$id.tsx");
const pdf = read("src/lib/po-pdf.ts");

test("Supplier RPC returns identity fields only for an authorized purchase order", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_po_supplier_for_document\(_po_id uuid\)/);
  assert.match(sql, /LANGUAGE plpgsql[\s\S]*?STABLE[\s\S]*?SECURITY DEFINER/);
  assert.match(sql, /public\.is_active_user\(actor\)/);
  assert.match(sql, /public\.has_permission\(actor, 'purchase_order\.view'\)/);
  assert.match(sql, /public\.po_can_view\(selected_po\.id\)/);
  assert.match(sql, /public\.actor_in_company\(selected_po\.company_id\)/);
  assert.match(sql, /public\.can_access_project\(actor, selected_po\.project_id\)/);
  assert.match(sql, /v\.id = selected_po\.vendor_id/);
  assert.match(sql, /v\.company_id = selected_po\.company_id/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_po_supplier_for_document\(uuid\)[\s\S]*?FROM PUBLIC, anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_po_supplier_for_document\(uuid\)[\s\S]*?TO authenticated/);
});

test("Site Engineer cannot query other suppliers, unselected bids or vendor bank fields", () => {
  assert.doesNotMatch(sql, /\b(bank_name|bank_account_number|bank_account_name|ifsc|pan|payment_terms_days)\s+text\b/i);
  assert.doesNotMatch(sql, /GRANT\s+SELECT\s+ON\s+public\.vendors/i);
  assert.doesNotMatch(sql, /JOIN\s+public\.vendor_quotations/i);
  assert.match(sql, /SELECT v\.company_name, v\.gstin, v\.address, v\.city, v\.state/);
  assert.match(sql, /v\.pincode, v\.contact_person, v\.mobile, v\.email/);
});

test("Site Engineer PDF resolves RLS-hidden vendor relation before generating PDF", () => {
  assert.match(helper, /get_po_supplier_for_document/);
  assert.match(helper, /if \(embeddedVendor\?\.company_name\?\.trim\(\)\) return embeddedVendor/);
  assert.match(helper, /throw new Error\("Supplier details for this purchase order could not be verified\."\)/);
  assert.match(review, /resolvePoSupplierForDocument\(poId, order\.data\.vendors\)/);
  assert.match(review, /buildPoReviewDocument\(\{[\s\S]*?vendors: supplier/);
  assert.match(pdf, /const supplier = po\.vendors/);
  assert.match(pdf, /"VENDOR \/ SUPPLIER"/);
});

test("PO details also show linked supplier identity instead of an empty name/GSTIN", () => {
  assert.match(detail, /resolvePoSupplierForDocument\(id, p\.data\.vendors\)/);
  assert.match(detail, /po: \{ \.\.\.p\.data, vendors: supplier \}/);
  assert.match(detail, /po\.vendors\?\.company_name/);
  assert.match(detail, /po\.vendors\?\.gstin/);
  assert.doesNotMatch(review, /vendors\(company_name,[^)]*bank_account_number/);
  assert.doesNotMatch(detail, /vendors\(company_name,[^)]*bank_account_number/);
});
