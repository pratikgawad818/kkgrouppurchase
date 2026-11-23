import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/migrations/0114_po_pdf_pr_requested_by.sql","utf8");
const pdf = readFileSync("src/lib/po-pdf.ts","utf8");
const loader = readFileSync("src/components/erp/po-review-actions.tsx","utf8");
const smoke = readFileSync("scripts/tests/po-layout-browser-smoke.mjs","utf8");

test("requested-by signatory is resolved from the originating PR, not the PO creator", () => {
  assert.match(sql, /JOIN public\.profiles profile ON profile\.id=pr\.requested_by/);
  assert.match(sql, /pr\.id=selected_po\.purchase_request_id/);
  assert.match(loader, /get_po_pr_requester_name/);
  assert.match(loader, /pr_requested_by_name: typeof prRequester\.data === "string"/);
  assert.match(pdf, /"PR Requested By", "Prepared by", "Approved by", "Authorised signatory"/);
  assert.match(smoke, /pr_requested_by_name: "Tanuj Shah"/);
});

test("new name lookup never grants all-staff directory access", () => {
  for (const guard of [
    "public.is_active_user(actor)", "public.has_permission(actor, 'purchase_order.view')",
    "public.po_can_view(selected_po.id)", "public.actor_in_company(selected_po.company_id)",
    "public.can_access_project(actor,selected_po.project_id)",
    "profile.company_id=pr.company_id",
    "pr.company_id=selected_po.company_id",
    "pr.project_id=selected_po.project_id",
    "REVOKE ALL ON FUNCTION public.get_po_pr_requester_name(uuid) FROM PUBLIC,anon",
  ]) assert.ok(sql.includes(guard), guard);
  assert.doesNotMatch(sql, /UPDATE public\.|INSERT INTO public\.|DELETE FROM public\./);
});

test("four signature cells wrap and reserve measured height on A4", () => {
  assert.match(pdf, /const w = CW \/ 4/);
  assert.match(pdf, /for \(let i = 0; i < 4; i\+\+\)/);
  assert.match(pdf, /signatureBlockHeight\(p, order\)/);
  assert.match(pdf, /breakLines\(p\.ctx, value, cellWidth - 2\)/);
});
