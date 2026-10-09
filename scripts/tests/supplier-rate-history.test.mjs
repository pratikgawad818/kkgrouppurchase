import assert from "node:assert/strict";
import test from "node:test";
import { extractAwardedPoRates, summarizeSupplierRates } from "../../src/lib/supplier-rate-history.ts";

const line = (material_id, unit_id, rate, ordered_quantity, discount_amount = 0) =>
  ({ material_id, unit_id, rate, ordered_quantity, discount_amount,
    items: { name: "Cement OPC 53", code: "CMT53" }, units_of_measure: { code: "BAG" } });
const po = (id, vendorId, date, rate, unit = "bag", status = "sent", qty = 10, discount = 0) => ({
  id, po_number: "PO-" + id, po_date: date, status, project_id: "project1",
  projects: { name: "Site A" }, vendor_id: vendorId, vendors: { company_name: vendorId },
  purchase_order_items: [line("cement", unit, rate, qty, discount)],
});

test("draft, rejected, pending and cancelled POs never drive supplier rate history", () => {
  const pos = ["draft", "pending_approval", "rejected", "cancelled"]
    .map((status, n) => po(String(n), "supplierA", "2026-10-09", 200, "bag", status));
  assert.equal(extractAwardedPoRates(pos).length, 0);
});

test("comparison respects material ID AND unit ID; no unsafe unit conversions", () => {
  const samples = extractAwardedPoRates([
    po("1", "supplierA", "2026-10-01", 350, "bag"),
    po("2", "supplierB", "2026-10-02", 8000, "ton"),
  ]);
  const results = summarizeSupplierRates(samples);
  assert.equal(results.length, 2);
  assert.equal(results[0].vendors.length, 1);
  assert.equal(results[1].vendors.length, 1);
});

test("vendor latest rate differs from historical volume-weighted average", () => {
  const samples = extractAwardedPoRates([
    po("1", "supplierA", "2026-09-01", 300, "bag", "sent", 10),
    po("2", "supplierA", "2026-10-01", 400, "bag", "fully_received", 30),
    po("3", "supplierB", "2026-10-05", 370, "bag", "sent", 2),
  ]);
  const [material] = summarizeSupplierRates(samples);
  assert.equal(material.vendors.length, 2);
  assert.equal(material.minLatestRate, 370);
  assert.equal(material.maxLatestRate, 400);
  const a = material.vendors.find(x => x.vendorId === "supplierA");
  assert.equal(a?.latest.rate, 400);
  assert.equal(a?.weightedRate, 375);
  assert.equal(a?.minRate, 300);
  assert.equal(a?.orderedQty, 40);
  assert.equal(material.latestDate, "2026-10-05");
});

test("discount is flagged; raw rate stays explicitly pre-discount", () => {
  const samples = extractAwardedPoRates([
    po("1", "supplierA", "2026-10-01", 100, "bag", "approved", 4, 25),
  ]);
  const [material] = summarizeSupplierRates(samples);
  assert.equal(material.vendors[0].latest.rate, 100);
  assert.equal(material.vendors[0].anyDiscount, true);
});

test("skip zero quantity, zero unit rate and invalid values", () => {
  const invalid = [
    po("a", "supplierA", "2026-10-09", 0),
    po("b", "supplierA", "2026-10-09", -20),
    po("c", "supplierA", "2026-10-09", 20, "bag", "approved", 0),
    po("d", "supplierA", "2026-10-09", Number.NaN),
  ];
  assert.equal(extractAwardedPoRates(invalid).length, 0);
});
