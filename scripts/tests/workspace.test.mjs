import test from "node:test";
import assert from "node:assert/strict";
import { workspaceNavigation, workspaceLocation } from "../../src/lib/workspace-navigation.ts";
import { orderedTasks, taskDue } from "../../src/lib/workspace-tasks.ts";

test("site staff navigation keeps operational scope without exposing finance or director approvals", () => {
  const groups = workspaceNavigation({
    roles: ["site_engineer"],
    permissions: new Set([
      "purchase_request.view",
      "purchase_request.create",
      "inventory.view",
      "grn.view",
    ]),
  });
  const paths = groups.flatMap((group) => group.items.map((item) => item.to));
  assert.ok(paths.includes("/procurement/purchase-requests"));
  assert.ok(paths.includes("/inventory/goods-received"));
  assert.ok(!paths.includes("/approvals"));
  assert.ok(!paths.includes("/finance/payments"));
  assert.ok(!paths.includes("/settings/users"));
});
test("management viewers retain their own home and never inherit document forms", () => {
  const groups = workspaceNavigation({
    roles: ["auditor"],
    permissions: new Set(["inventory.view", "payable.view", "payment.view", "units.view"]),
  });
  assert.equal(groups.find((group) => group.key === "home").items[0].to, "/management");
  assert.ok(
    !groups
      .flatMap((group) => group.items)
      .some((item) => item.to === "/dashboard" || item.to.startsWith("/procurement/")),
  );
});
test("deep document navigation identifies the containing module", () => {
  const groups = workspaceNavigation({
    roles: ["purchase_manager"],
    permissions: new Set(["purchase_order.view", "rfq.view"]),
  });
  assert.equal(
    workspaceLocation("/procurement/purchase-orders/a-document-id", groups).group.key,
    "purchasing",
  );
  assert.equal(
    workspaceLocation("/procurement/purchase-orders/a-document-id", groups).item.label,
    "Purchase orders",
  );
  assert.equal(workspaceLocation("/finance/payments/hidden-document", groups), undefined);
});
test("an approver permission alone never creates a director approval menu for a non-director", () => {
  assert.ok(
    !workspaceNavigation({
      roles: ["site_engineer"],
      permissions: new Set(["payment.approve", "purchase_order.approve"]),
    }).some((group) => group.key === "approvals"),
  );
});
test("due dates use calendar days, including month and year boundaries", () => {
  assert.equal(taskDue("2027-01-01", "2026-12-31").label, "Tomorrow");
  assert.equal(taskDue("2026-11-01", "2026-10-31").label, "Tomorrow");
  assert.equal(taskDue("2026-10-15", "2026-10-16").tone, "overdue");
  assert.equal(taskDue("2026-10-16", "2026-10-16").label, "Today");
  assert.equal(taskDue(null, "2026-10-16").label, "No due date");
});
test("task grouping keeps overdue work ahead of undated work without mutating cached rows", () => {
  const input = [
    { id: "a", number: "PO-2", group: "purchasing", due: null },
    { id: "b", number: "PAY-1", group: "payments", due: "2026-10-15" },
    { id: "c", number: "PO-1", group: "purchasing", due: "2026-10-16" },
  ];
  assert.deepEqual(
    orderedTasks(input, "all").map((task) => task.id),
    ["b", "c", "a"],
  );
  assert.deepEqual(
    orderedTasks(input, "purchasing").map((task) => task.id),
    ["c", "a"],
  );
  assert.deepEqual(
    input.map((task) => task.id),
    ["a", "b", "c"],
  );
});
