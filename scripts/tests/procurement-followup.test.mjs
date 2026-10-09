import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarDaysBetween,
  deliverySnapshot,
  isOverdueApprovedInvoice,
  needsInvoiceMatchReview,
} from "../../src/lib/procurement-followup.ts";

const base = {
  status: "sent",
  expected_delivery_date: "2026-10-08",
  purchase_order_items: [
    { ordered_quantity: 10, accepted_quantity: 4, short_closed_quantity: 2, line_total: 1000 },
  ],
};

test("uses accepted, not physically received, material; respects short closing", () => {
  const d = deliverySnapshot(base, "2026-10-09");
  assert.ok(d);
  assert.equal(d.priority, "overdue");
  assert.equal(d.daysUntilDue, -1);
  assert.equal(d.estimatedOpenLineValue, 400);
  assert.equal(d.acceptancePercent, 50);
  assert.equal(d.openLines, 1);
});

test("a fully accepted or short-closed PO is not an outstanding delivery", () => {
  assert.equal(deliverySnapshot({ ...base, purchase_order_items: [{ ...base.purchase_order_items[0], accepted_quantity: 8 }] }, "2026-10-09"), null);
  assert.equal(deliverySnapshot({ ...base, purchase_order_items: [{ ...base.purchase_order_items[0], short_closed_quantity: 10 }] }, "2026-10-09"), null);
});

test("draft, closed and cancelled POs are never in the delivery follow-up queue", () => {
  for (const status of ["draft", "pending_approval", "fully_received", "closed", "cancelled"]) {
    assert.equal(deliverySnapshot({ ...base, status }, "2026-10-09"), null);
  }
});

test("delivery priority covers due today, upcoming, and missing dates", () => {
  const today = "2026-10-09";
  assert.equal(deliverySnapshot({ ...base, expected_delivery_date: today }, today)?.priority, "due_soon");
  assert.equal(deliverySnapshot({ ...base, expected_delivery_date: "2026-10-17" }, today)?.priority, "on_track");
  assert.equal(deliverySnapshot({ ...base, expected_delivery_date: null }, today)?.priority, "unscheduled");
});

test("calendar dates do not shift with local time-zone or DST", () => {
  assert.equal(calendarDaysBetween("2026-03-31", "2026-04-01"), 1);
  assert.equal(calendarDaysBetween("2026-10-09", "2026-10-08"), -1);
});

test("no item quantities -> no false outstanding deliveries", () => {
  assert.equal(deliverySnapshot({ ...base, purchase_order_items: [] }, "2026-10-09"), null);
  assert.equal(deliverySnapshot({ ...base, purchase_order_items: [{ ordered_quantity: 0, accepted_quantity: 0, short_closed_quantity: 0, line_total: 0 }] }, "2026-10-09"), null);
});

test("invoice exceptions do not count paid, rejected or cancelled bills", () => {
  const template = { status: "exception", match_status: "exception", due_date: "2026-10-07", balance_due: 200 };
  assert.equal(needsInvoiceMatchReview(template), true);
  assert.equal(needsInvoiceMatchReview({ ...template, status: "paid" }), false);
  assert.equal(needsInvoiceMatchReview({ ...template, status: "rejected" }), false);
  assert.equal(needsInvoiceMatchReview({ ...template, status: "cancelled" }), false);
  assert.equal(needsInvoiceMatchReview({ ...template, status: "pending_review", match_status: "exception" }), true);
});

test("only unpaid approved/partially-paid and past-due invoices are overdue payables", () => {
  const b = { status: "approved", match_status: "matched", due_date: "2026-10-08", balance_due: 500 };
  assert.equal(isOverdueApprovedInvoice(b, "2026-10-09"), true);
  assert.equal(isOverdueApprovedInvoice({ ...b, status: "partially_paid" }, "2026-10-09"), true);
  assert.equal(isOverdueApprovedInvoice({ ...b, status: "exception" }, "2026-10-09"), false);
  assert.equal(isOverdueApprovedInvoice({ ...b, due_date: "2026-10-09" }, "2026-10-09"), false);
  assert.equal(isOverdueApprovedInvoice({ ...b, balance_due: 0 }, "2026-10-09"), false);
});
