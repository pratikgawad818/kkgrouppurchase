import assert from "node:assert/strict";
import test from "node:test";
import { inspectVendorInvoice } from "../../src/lib/invoice-preflight.ts";

const header = {
  vendor_invoice_number: "SUP-2026-100",
  vendor_invoice_date: "2026-10-09",
  due_date: "2026-11-08",
  freight: "50",
  other_charges: "0",
  tds_rate: "2",
};

const line = (patch = {}) => ({
  grn_item_id: "receipt-1", material: "Cement OPC", include: true,
  quantity: "5", available: 8, rate: "350.00", po_rate: 350,
  tax_rate_percent: "18", po_tax: 18, ...patch,
});

test("valid accepted GRN quantity with matching rates/tax passes preflight", () => {
  const r = inspectVendorInvoice([line()], header);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.advisories, []);
  assert.equal(r.lineCount, 1);
  assert.equal(r.hasVariances, false);
});

test("cannot invoice rejected, previously billed, or unavailable quantities", () => {
  const a = inspectVendorInvoice([line({ quantity: "9", available: 8 })], header);
  assert.match(a.errors.join(" "), /only 8 accepted units remain/);
  const b = inspectVendorInvoice([line({ available: NaN })], header);
  assert.match(b.errors.join(" "), /unavailable/);
  const c = inspectVendorInvoice([line({ available: -3 })], header);
  assert.match(c.errors.join(" "), /unavailable/);
});

test("forbids a duplicate GRN line within the same invoice", () => {
  const r = inspectVendorInvoice([line({ quantity: "2" }), line({ quantity: "2" })], header);
  assert.match(r.errors.join(" "), /same GRN line/);
});

test("invalid quantity/price/tax precision or negative values block saving", () => {
  for (const value of ["0", "-1", "", "5.0009", "Infinity", "NaN"]) {
    const r = inspectVendorInvoice([line({ quantity: value })], header);
    assert.ok(r.errors.length > 0, `must reject quantity ${value}`);
  }
  for (const rate of ["-1", "12.003", "Infinity", "NaN", ""]) {
    const r = inspectVendorInvoice([line({ rate })], header);
    assert.ok(r.errors.length > 0, `must reject rate ${rate}`);
  }
  for (const tax of ["-1", "101", "18.001", "NaN"]) {
    const r = inspectVendorInvoice([line({ tax_rate_percent: tax })], header);
    assert.ok(r.errors.length > 0, `must reject tax ${tax}`);
  }
});

test("detects PO unit rate and GST differences as review advisories, not bypass approval", () => {
  const r = inspectVendorInvoice([line({ rate: "360", tax_rate_percent: "12" })], header);
  assert.deepEqual(r.errors, []);
  assert.equal(r.hasVariances, true);
  assert.match(r.advisories.join(" "), /rates different/);
  assert.match(r.advisories.join(" "), /GST percentages different/);
});

test("zero rate requires confirmation but can represent free-of-charge replacement goods", () => {
  const r = inspectVendorInvoice([line({ rate: "0" })], header);
  assert.deepEqual(r.errors, []);
  assert.match(r.advisories.join(" "), /zero supplier rate/);
});

test("bill number, dates, and non-negative charges are required", () => {
  const r = inspectVendorInvoice([line()], {
    ...header, vendor_invoice_number: " ", vendor_invoice_date: "",
    freight: "-10", other_charges: "12.123", tds_rate: "105",
  });
  const message = r.errors.join(" ");
  for (const expected of ["bill number", "bill date", "Freight", "Other charges", "TDS"]) {
    assert.ok(message.includes(expected), expected);
  }
});

test("due date before supplier bill is visible as a warning, not silently ignored", () => {
  const r = inspectVendorInvoice([line()], { ...header, due_date: "2026-10-01" });
  assert.deepEqual(r.errors, []);
  assert.match(r.advisories.join(" "), /Due date is before/);
});

test("a disabled line is never saved or included in validation", () => {
  const r = inspectVendorInvoice([line({ include: false, quantity: "-5", rate: "-500" }), line({ grn_item_id: "receipt-2" })], header);
  assert.deepEqual(r.errors, []);
  assert.equal(r.lineCount, 1);
});

test("unselected or empty GRN invoices are blocked from saving", () => {
  assert.match(inspectVendorInvoice([], header).errors.join(" "), /Select at least one/);
  assert.match(inspectVendorInvoice([line({ include: false })], header).errors.join(" "), /Select at least one/);
});
