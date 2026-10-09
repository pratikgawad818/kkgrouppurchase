import assert from "node:assert/strict";
import test from "node:test";
import { openPoQuantity, planReorders } from "../../src/lib/reorder-planning.ts";

const cement = { id: "cement", name: "Cement OPC", code: "CMT", status: "active",
  minimum_stock: 5, reorder_level: 10, maximum_stock: 30, units_of_measure: { code: "BAG" } };
const steel = { id: "steel", name: "TMT steel", code: "TMT", status: "active",
  minimum_stock: 0, reorder_level: 0, maximum_stock: 20, units_of_measure: { code: "KG" } };
const unconfigured = { ...cement, id: "unknown", code: "UNKNOWN", minimum_stock: 0, reorder_level: 0, maximum_stock: null };
const wh1 = { id: "wh1", code: "S1", name: "Site 1", status: "active", project_id: "p1" };
const wh2 = { id: "wh2", code: "S2", name: "Site 2", status: "active", project_id: "p2" };
const po = (id, store, mat, qty, accepted = 0, closed = 0, date = "2026-10-11", status = "sent") => ({
  id, po_number: "PO-" + id, status, delivery_warehouse_id: store,
  expected_delivery_date: date, purchase_order_items: [{
    material_id: mat, ordered_quantity: qty, accepted_quantity: accepted, short_closed_quantity: closed,
  }],
});

test("reorder point uses max of minimum stock and reorder level, target is maximum stock", () => {
  const r = planReorders([cement], [wh1], [{ warehouse_id: "wh1", material_id: "cement", quantity_on_hand: 8 }], [], "2026-10-09");
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].reorderPoint, 10);
  assert.equal(r.lines[0].target, 30);
  assert.equal(r.lines[0].state, "order_review");
  assert.equal(r.lines[0].suggestedTopUp, 22);
  assert.equal(r.lines[0].gapToReorderPoint, 2);
});

test("incoming same-warehouse open orders prevent recommending duplicate purchase quantities", () => {
  const r = planReorders([cement], [wh1], [{ warehouse_id: "wh1", material_id: "cement", quantity_on_hand: 8 }],
    [po("a", "wh1", "cement", 12, 3, 0)], "2026-10-09");
  // 12 ordered - 3 accepted = 9 still due; 8+9=17 exceeds trigger=10.
  assert.equal(r.lines[0].incoming, 9);
  assert.equal(r.lines[0].projectedIfDelivered, 17);
  assert.equal(r.lines[0].state, "await_inbound");
  assert.equal(r.lines[0].suggestedTopUp, 0);
});

test("incoming PO with insufficient remaining qty still triggers top-up for the same store", () => {
  const r = planReorders([cement], [wh1], [{ warehouse_id: "wh1", material_id: "cement", quantity_on_hand: 2 }],
    [po("a", "wh1", "cement", 9, 5, 2)], "2026-10-09");
  assert.equal(r.lines[0].incoming, 2);
  assert.equal(r.lines[0].projectedIfDelivered, 4);
  assert.equal(r.lines[0].suggestedTopUp, 26);
  assert.equal(r.lines[0].state, "order_review");
});

test("unallocated PO is never counted as delivery to any site", () => {
  const r = planReorders([cement], [wh1, wh2], [{ warehouse_id: "wh1", material_id: "cement", quantity_on_hand: 1 }],
    [po("a", null, "cement", 24)], "2026-10-09");
  assert.equal(r.lines.length, 1, "do not invent a row for wh2");
  assert.equal(r.lines[0].incoming, 0);
  assert.equal(r.lines[0].unassignedIncoming, 24);
  assert.equal(r.unallocated[0].qty, 24);
});

test("stock in another warehouse cannot count toward site store availability", () => {
  const r = planReorders([cement], [wh1, wh2], [
    { warehouse_id: "wh1", material_id: "cement", quantity_on_hand: 100 },
    { warehouse_id: "wh2", material_id: "cement", quantity_on_hand: 2 },
  ], [], "2026-10-09");
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].store.id, "wh2");
  assert.equal(r.lines[0].suggestedTopUp, 28);
});

test("active PO with explicit delivery warehouse reveals an out-of-stock planned location", () => {
  const r = planReorders([cement], [wh1, wh2], [],
    [po("a", "wh2", "cement", 6, 0, 0, null)], "2026-10-09");
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].onHand, 0);
  assert.equal(r.lines[0].store.id, "wh2");
  assert.equal(r.lines[0].hasUndatedInbound, true);
  assert.equal(r.lines[0].state, "out_of_stock");
  assert.equal(r.lines[0].suggestedTopUp, 24);
});

test("past due and missing delivery dates remain explicit risk signals", () => {
  const r = planReorders([cement], [wh1], [{ warehouse_id: "wh1", material_id: "cement", quantity_on_hand: 0 }],
    [po("late", "wh1", "cement", 5, 0, 0, "2026-10-02"), po("undated", "wh1", "cement", 5, 0, 0, null)], "2026-10-09");
  assert.equal(r.lines[0].hasOverdueInbound, true);
  assert.equal(r.lines[0].hasUndatedInbound, true);
  assert.equal(r.lines[0].incoming, 10);
});

test("inactive stores and materials never generate alerts", () => {
  const r = planReorders([cement, { ...cement, id: "inactive", status: "inactive" }], [wh1, { ...wh2, status: "inactive" }], [
    { warehouse_id: "wh1", material_id: "inactive", quantity_on_hand: 0 },
    { warehouse_id: "wh2", material_id: "cement", quantity_on_hand: 0 },
  ], [], "2026-10-09");
  assert.equal(r.lines.length, 0);
});

test("no reorder settings never fabricate a replenishment recommendation", () => {
  const r = planReorders([unconfigured], [wh1], [{ warehouse_id: "wh1", material_id: "unknown", quantity_on_hand: 0 }],
    [], "2026-10-09");
  assert.equal(r.lines.length, 0);
  assert.equal(r.unconfiguredStockLines, 1);
});

test("no positive max target leaves quantity for human decision, not fictional estimate", () => {
  const r = planReorders([{ ...cement, maximum_stock: null }], [wh1], [
    { warehouse_id: "wh1", material_id: "cement", quantity_on_hand: 10 },
  ], [], "2026-10-09");
  assert.equal(r.lines[0].gapToReorderPoint, 0);
  assert.equal(r.lines[0].suggestedTopUp, null);
});

test("material with no visible stock or PO warehouse is never auto-assigned to all stores", () => {
  const r = planReorders([cement], [wh1, wh2], [], [], "2026-10-09");
  assert.equal(r.lines.length, 0);
  assert.deepEqual(r.notAssignedToStore.map(m => m.id), ["cement"]);
});

test("zero reorder point plus configured max triggers only at empty stock", () => {
  const r = planReorders([steel], [wh1], [
    { warehouse_id: "wh1", material_id: "steel", quantity_on_hand: 0 },
  ], [], "2026-10-09");
  assert.equal(r.lines[0].suggestedTopUp, 20);
  assert.equal(r.lines[0].state, "out_of_stock");
});

test("cancellation, draft and fully received POs must not count as incoming", () => {
  const statuses = ["draft", "pending_approval", "fully_received", "closed", "short_closed", "cancelled", "rejected"];
  const r = planReorders([cement], [wh1], [{ warehouse_id: "wh1", material_id: "cement", quantity_on_hand: 1 }],
    statuses.map((x,i)=>po(String(i), "wh1", "cement", 40, 0, 0, null, x)), "2026-10-09");
  assert.equal(r.lines[0].incoming, 0);
});

test("accepted plus short-closed quantities are never counted as incoming again", () => {
  assert.equal(openPoQuantity({ material_id: "cement", ordered_quantity: 10, accepted_quantity: 6, short_closed_quantity: 3 }), 1);
  assert.equal(openPoQuantity({ material_id: "cement", ordered_quantity: 10, accepted_quantity: 10, short_closed_quantity: 6 }), 0);
  assert.equal(openPoQuantity({ material_id: "cement", ordered_quantity: 10, accepted_quantity: -1, short_closed_quantity: -2 }), 10);
});
