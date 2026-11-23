import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/migrations/0111_pr_requester_procurement_milestones.sql", "utf8");

test("all procurement milestones have event-level database triggers", () => {
  for (const table of ["rfqs", "purchase_orders", "vendor_delivery_challans", "goods_receipt_notes"]) {
    assert.match(sql, new RegExp("ON public\\." + table + " FOR EACH ROW"));
  }
});

test("notification recipient is original active PR engineer, scoped to their company and project", () => {
  for (const predicate of [
    "p.id=pr.requested_by", "p.company_id=pr.company_id AND p.is_active",
    "pr.company_id=_company AND pr.project_id=_project",
    "public.has_role(p.id,'site_engineer')",
    "public.has_permission(p.id,'purchase_request.view')",
    "public.can_access_project(p.id,pr.project_id)",
  ]) assert.ok(sql.includes(predicate), predicate);
  assert.match(sql, /'\/procurement\/purchase-requests\/'\|\|pr.id/);
});

test("milestones are driven by persisted state changes, not ordinary edits", () => {
  assert.match(sql, /NEW.status IS NOT DISTINCT FROM OLD.status/g);
  assert.match(sql, /NEW.status NOT IN \('sent','ready_for_po'\)/);
  assert.match(sql, /NEW.status NOT IN \('pending_approval','sent'\)/);
  assert.match(sql, /NEW.status NOT IN \('posted','cancelled'\)/);
});

test("Director approval remains with existing PO status trigger; no invoice or payment alert leaks", () => {
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public.notify_on_po_status/);
  assert.doesNotMatch(sql, /vendor_invoice|vendor_payment/i);
  assert.match(sql, /A draft GRN is not verified stock/);
});
