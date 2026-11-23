import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/migrations/0113_partial_rfq_vendor_award.sql", "utf8");
const comparison = readFileSync("src/routes/_authenticated/_shell/procurement.rfqs.$id.compare.tsx", "utf8");

test("RFQ can award a nonempty subset without requiring every original PR item", () => {
  assert.match(sql, /jsonb_array_length\(_selections\) < 1/);
  assert.match(sql, /jsonb_array_length\(_selections\) > total_items/);
  assert.doesNotMatch(sql, /jsonb_array_length\(_selections\) <> total_items/);
  assert.match(sql, /jsonb_array_length\(_selections\) < total_items/);
  assert.match(sql, /Explain why unselected materials/);
});

test("partial selection checks project and company, active actor, quote validity, and duplicate items", () => {
  for (const required of [
    "public.is_active_user(auth.uid())", "public.actor_in_company(r.company_id)",
    "public.can_access_project(auth.uid(),r.project_id)",
    "public.has_permission(auth.uid(),'quotation.select_vendor')",
    "qi.rfq_item_id=ANY(selected_item_ids)",
    "qi.qstatus<>'submitted'",
    "qi.quoted_quantity<=0",
    "qi.valid_until<public.ist_today()",
  ]) assert.ok(sql.includes(required), required);
  assert.match(sql, /SELECT \* INTO r FROM public.rfqs WHERE id=_rfq_id FOR UPDATE/);
});

test("UI requires explicit exclusions and documents them before a partial award", () => {
  assert.match(comparison, /Exclude from this PO/);
  assert.match(comparison, /toggleSkip\(it.id\)/);
  assert.match(comparison, /const pendingCount = items.filter/);
  assert.match(comparison, /pendingCount === 0/);
  assert.match(comparison, /Object.keys\(pick\).length > 0/);
  assert.match(comparison, /skippedCount > 0 \? 15 : 3/);
  assert.match(comparison, /not automatically fulfilled or cancelled/);
  assert.match(comparison, /Confirm selected materials/);
});

test("underlying PR and commercial document history are preserved", () => {
  assert.doesNotMatch(sql, /UPDATE public.purchase_requests|DELETE FROM public.purchase_request_items/);
  assert.doesNotMatch(sql, /DELETE FROM public.vendor_quotations|DELETE FROM public.purchase_orders/);
  assert.match(sql, /UPDATE public.rfqs SET status='ready_for_po',selection_reason=btrim\(_reason\)/);
});
