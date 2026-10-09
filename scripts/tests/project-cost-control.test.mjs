import test from "node:test";
import assert from "node:assert/strict";
import { summarizeProjectCosts } from "../../src/lib/project-cost-control.ts";

const projects = [
  { id: "p1", name: "Building A", code: "A1", status: "under_construction", budget: 100000, estimated_cost: 150000 },
  { id: "p2", name: "Building B", code: "B1", status: "planning", budget: 0, estimated_cost: 0 },
];
const poLine = (ordered_quantity, accepted_quantity, short_closed_quantity, line_total) =>
  ({ ordered_quantity, accepted_quantity, short_closed_quantity, line_total });

test("report never double counts approved invoices and stock consumption as one expense", () => {
  const [p1, p2] = summarizeProjectCosts(projects,
    [{ project_id: "p1", status: "sent", purchase_order_items: [poLine(10, 4, 2, 1000)] }],
    [{ project_id: "p1", net_value: 300 }, { project_id: "p1", net_value: -50 }],
    [{ project_id: "p1", status: "approved", net_payable: 900, balance_due: 700 }]
  );
  assert.equal(p1.netMaterialConsumed, 250);
  assert.equal(p1.estimatedOpenPoLines, 400);
  assert.equal(p1.approvedInvoiceValue, 900);
  assert.equal(p1.approvedUnpaidInvoices, 700);
  assert.equal(p1.materialToBudgetPercent, 0.3); // 250 / 100000 * 100, rounded to 0.1%
  assert.equal(p2.netMaterialConsumed, 0);
  assert.equal(p2.materialToBudgetPercent, null, "zero budget means unset, not an infinite percentage");
});

test("exclude cancelled/draft/pending-approval PO commitments and invoice exceptions", () => {
  const pos = ["cancelled", "draft", "pending_approval", "fully_received", "closed"]
    .map(status => ({ project_id: "p1", status, purchase_order_items: [poLine(5, 0, 0, 900)] }));
  const bills = ["draft", "pending_review", "exception", "rejected", "cancelled"]
    .map(status => ({ project_id: "p1", status, net_payable: 800, balance_due: 800 }));
  const [p] = summarizeProjectCosts(projects.slice(0, 1), pos, [], bills);
  assert.equal(p.estimatedOpenPoLines, 0);
  assert.equal(p.approvedInvoiceValue, 0);
  assert.equal(p.approvedUnpaidInvoices, 0);
});

test("paid invoices remain in approved bill value but not unpaid balance", () => {
  const [p] = summarizeProjectCosts(projects.slice(0, 1), [], [], [
    { project_id: "p1", status: "paid", net_payable: 1500, balance_due: 0 },
    { project_id: "p1", status: "partially_paid", net_payable: 2000, balance_due: 300 },
  ]);
  assert.equal(p.approvedInvoiceValue, 3500);
  assert.equal(p.approvedUnpaidInvoices, 300);
});

test("negative net consumption reversals reduce material use; no leakage across project IDs", () => {
  const [a, b] = summarizeProjectCosts(projects, [], [
    { project_id: "p1", net_value: 1500 },
    { project_id: "p1", net_value: -500 },
    { project_id: "p2", net_value: 1000 },
    { project_id: "hidden-project", net_value: 99999 },
  ], []);
  assert.equal(a.netMaterialConsumed, 1000);
  assert.equal(b.netMaterialConsumed, 1000);
  assert.equal(b.materialToBudgetPercent, null);
});

test("material usage over budget remains visible as a percent above 100", () => {
  const [p] = summarizeProjectCosts(projects.slice(0, 1), [], [{ project_id: "p1", net_value: 120000 }], []);
  assert.equal(p.materialToBudgetPercent, 120);
});

test("material consumption is distinct from PO cost after partial issue and vendor invoice", () => {
  const [p] = summarizeProjectCosts(projects.slice(0, 1),
    [{ project_id: "p1", status: "partially_received", purchase_order_items: [poLine(10, 6, 0, 1000)] }],
    [{ project_id: "p1", net_value: 200 }],
    [{ project_id: "p1", status: "paid", net_payable: 600, balance_due: 0 }]
  );
  assert.equal(p.estimatedOpenPoLines, 400);
  assert.equal(p.netMaterialConsumed, 200);
  assert.equal(p.approvedInvoiceValue, 600);
  assert.equal(p.approvedUnpaidInvoices, 0);
});
