import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  workflowPresentation,
  workflowEventTitle,
  workflowEventTone,
  chronologicalWorkflowEvents,
} from "../../src/lib/workflow-progress.ts";

test("Site Engineer sees the next eligible PR approver without inventing a named person", () => {
  const pending = workflowPresentation("purchase_request", "pending_approval");
  assert.equal(pending.stateLabel, "Awaiting purchasing review");
  assert.equal(pending.nextTitle, "Review and receive the purchase request");
  assert.match(pending.nextOwner, /Project Manager \/ Purchase Manager \/ Director/);
  assert.match(pending.nextDescription, /other than the requester/);
  assert.equal(pending.stages[0].state, "complete");
  assert.equal(pending.stages[1].state, "current");
  assert.equal(pending.finished, false);
});

test("PR return shows correction owner, not false approval or a ghost next director", () => {
  const returned = workflowPresentation("purchase_request", "draft", undefined, "returned");
  assert.match(returned.stateLabel, /Returned/);
  assert.match(returned.nextOwner, /Request creator/);
  assert.match(returned.nextTitle, /resubmit/);
  assert.equal(returned.stages[0].state, "current");
  const fresh = workflowPresentation("purchase_request", "draft", undefined, "created");
  assert.equal(fresh.stateLabel, "Draft");
});

test("Approved PR follows actual RFQ visibility; does not claim no RFQ for unauthorized viewers", () => {
  const unknown = workflowPresentation("purchase_request", "approved");
  assert.match(unknown.nextDescription, /issue an RFQ/);
  assert.doesNotMatch(unknown.nextDescription, /No RFQ/);
  const noRfqs = workflowPresentation("purchase_request", "approved", []);
  assert.equal(noRfqs.nextTitle, "Create the RFQ");
  const draft = workflowPresentation("purchase_request", "approved", ["draft"]);
  assert.equal(draft.nextTitle, "Send the prepared RFQ");
  const quoted = workflowPresentation("purchase_request", "approved", ["fully_responded"]);
  assert.equal(quoted.nextTitle, "Compare quotations and select the supplier");
  const ready = workflowPresentation("purchase_request", "approved", ["ready_for_po"]);
  assert.equal(ready.nextTitle, "Continue Purchase Order processing");
  assert.match(ready.nextDescription, /check for an existing PO/);
  const closed = workflowPresentation("purchase_request", "approved", ["closed"]);
  assert.equal(closed.nextTitle, "Check linked PO and RFQ closeout");
  assert.equal(ready.stages[2].state, "complete");
});

test("Site Engineer sees Purchase Manager receipt, not a misleading second PO approval", () => {
  const received = workflowPresentation("purchase_request", "approved", []);
  assert.equal(received.stateLabel, "Purchase Manager received your request");
  assert.equal(received.stages[1].label, "Purchase Manager review");
  assert.equal(received.nextTitle, "Create the RFQ");
  assert.match(received.nextDescription, /received for procurement/);
  assert.equal(workflowEventTitle("purchase_request", {
    id: "manager-1", action: "approved", occurredAt: "2026-11-22T09:00:00Z",
    actorName: "Purchase Manager",
  }), "Purchase Manager received your request");
  assert.equal(workflowEventTitle("purchase_request", {
    id: "director-1", action: "approved", occurredAt: "2026-11-22T09:00:00Z",
    comment: "Finalized by the requesting Director; no additional approval required.",
  }), "Request finalized by requesting Director");
  const po = workflowPresentation("purchase_order", "pending_approval");
  assert.equal(po.stateLabel, "Awaiting Director approval");
  assert.equal(workflowEventTitle("purchase_order", {
    id: "po-approved", action: "approved", occurredAt: "2026-11-22T10:00:00Z",
  }), "Purchase Order approved");
  const prFile = readFileSync("src/lib/pr.ts","utf8");
  const detailFile = readFileSync(
    "src/routes/_authenticated/_shell/procurement.purchase-requests.$id.index.tsx","utf8");
  const dashboardFile = readFileSync("src/lib/purchase-pipeline.ts","utf8");
  assert.match(prFile, /Request received · RFQ ready/);
  assert.match(prFile, /approved: "Purchase Manager received your request"/);
  assert.match(detailFile, /"Receive request" : "Accept for procurement"/);
  assert.match(detailFile, /It does not approve the final Purchase Order/);
  assert.match(dashboardFile, /Purchase Manager received your request — prepare RFQ/);
});

test("Independent Director is responsible for pending PO and payment approvals", () => {
  const po = workflowPresentation("purchase_order", "pending_approval");
  const payment = workflowPresentation("vendor_payment", "scheduled");
  for (const item of [po, payment]) {
    assert.equal(item.nextOwner, "Independent Director");
    assert.match(item.nextDescription, /did not create|other than the payment creator/);
    assert.equal(item.stages[1].state, "current");
  }
});

test("PO follows approval, vendor delivery and reconciliation without inventing completions", () => {
  const approved = workflowPresentation("purchase_order", "approved");
  assert.equal(approved.nextOwner, "Purchase Manager / authorized purchasing staff");
  assert.equal(approved.stages[2].state, "current");
  const sent = workflowPresentation("purchase_order", "sent");
  assert.equal(sent.nextOwner, "Site Engineer / Store team");
  assert.equal(sent.stages[3].state, "current");
  const partial = workflowPresentation("purchase_order", "partially_accepted");
  assert.match(partial.nextTitle, /pending delivery/);
  assert.equal(partial.stages[3].state, "current");
  const received = workflowPresentation("purchase_order", "fully_received");
  assert.equal(received.stages[4].state, "current");
  const closed = workflowPresentation("purchase_order", "closed");
  assert.equal(closed.finished, true);
  assert.equal(closed.stages.every((stage) => stage.state === "complete"), true);
});

test("Payment moves from director decision to Accounts Manager and stops after recorded", () => {
  const approved = workflowPresentation("vendor_payment", "approved");
  assert.match(approved.nextOwner, /Accounts Manager/);
  assert.equal(approved.stages[2].state, "current");
  const recorded = workflowPresentation("vendor_payment", "recorded");
  assert.equal(recorded.nextTitle, null);
  assert.equal(recorded.finished, true);
  assert.equal(recorded.stages[2].state, "complete");
});

test("Cancelled or rejected documents have no misleading pending next approver", () => {
  for (const [kind, status] of [
    ["purchase_request", "rejected"],
    ["purchase_request", "cancelled"],
    ["purchase_order", "cancelled"],
    ["vendor_payment", "cancelled"],
  ]) {
    const flow = workflowPresentation(kind, status);
    assert.equal(flow.finished, true, kind + "/" + status);
    assert.equal(flow.blocked, true);
    assert.equal(flow.nextOwner, null);
    assert.equal(flow.nextTitle, null);
  }
});

test("Real audit history retains original actor, time, comment and event ordering", () => {
  const events = [
    { id: "b", action: "approved", occurredAt: "2026-11-19T11:00:00Z", actorName: "Approver" },
    { id: "a", action: "submitted", occurredAt: "2026-11-19T09:00:00Z", actorName: "Engineer" },
  ];
  const sorted = chronologicalWorkflowEvents(events);
  assert.deepEqual(sorted.map((event) => event.id), ["a", "b"]);
  assert.equal(sorted[0].actorName, "Engineer");
  assert.equal(workflowEventTitle("purchase_request", sorted[0]), "Submitted for approval");
  assert.equal(workflowEventTitle("purchase_request", { ...sorted[0], newStatus: "approved" }), "Request finalized by creating Director");
  assert.equal(workflowEventTone({ id:"r", action:"returned", occurredAt:"2026-11-19T10:00:00Z" }), "warning");
});

test("The same full history component is mounted on PR, PO and payment detail pages", () => {
  const root = "../../src/routes/_authenticated/_shell/";
  for (const file of [
    "procurement.purchase-requests.$id.index.tsx",
    "procurement.purchase-orders.$id.tsx",
    "finance.payments.$id.tsx",
  ]) {
    const content = readFileSync(new URL(root + file, import.meta.url), "utf8");
    assert.match(content, /<WorkflowTimeline/);
    assert.match(content, /events=\{/);
  }
});
