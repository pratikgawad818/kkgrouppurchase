import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const deployed = readFileSync("drizzle/migrations/0111_pr_requester_stage_notifications.sql","utf8");
const extra = readFileSync("drizzle/migrations/0112_complete_pr_stage_notifications.sql","utf8");

test("base stage notifications remain intact and new migration has a unique number", () => {
  assert.match(deployed, /CREATE TRIGGER notify_pr_engineer_po_handoff_status/);
  assert.match(deployed, /CREATE TRIGGER notify_pr_engineer_challan_registered/);
  assert.match(deployed, /CREATE TRIGGER notify_pr_engineer_grn_stage/);
  assert.doesNotMatch(extra, /CREATE OR REPLACE FUNCTION public.notify_pr_original_site_engineer/);
  assert.doesNotMatch(extra, /CREATE OR REPLACE FUNCTION public.notify_on_po_status/);
});

test("0112 adds only RFQ, vendor dispatch and challan cancellation triggers", () => {
  assert.match(extra, /CREATE TRIGGER notify_pr_engineer_rfq_progress_stage/);
  assert.match(extra, /CREATE TRIGGER notify_pr_engineer_po_vendor_dispatch_stage/);
  assert.match(extra, /CREATE TRIGGER notify_pr_engineer_challan_cancellation_stage/);
  const matches = [...extra.matchAll(/CREATE TRIGGER /g)];
  assert.equal(matches.length,3);
});

test("notifications happen only after an actual relevant status transition", () => {
  assert.match(extra, /NEW.status NOT IN \('sent','ready_for_po'\)/);
  assert.match(extra, /NEW.status<>'sent'/);
  assert.match(extra, /NEW.status<>'cancelled'/);
  assert.equal((extra.match(/NEW.status IS NOT DISTINCT FROM OLD.status/g)||[]).length,3);
});

test("new triggers reuse existing per-PR original Site Engineer security check", () => {
  assert.equal((extra.match(/PERFORM public.notify_pr_original_site_engineer\(/g)||[]).length,3);
  assert.match(deployed, /original.id=pr.requested_by/);
  assert.match(deployed, /public.can_access_project\(original.id,_project\)/);
  assert.doesNotMatch(extra, /INSERT INTO public.notifications|UPDATE public.purchase_requests|DELETE FROM/);
});
