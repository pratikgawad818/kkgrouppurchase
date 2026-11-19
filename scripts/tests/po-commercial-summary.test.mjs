import test from "node:test";
import assert from "node:assert/strict";
import { poCommercialSummary } from "../../src/lib/po-commercial-summary.ts";

test("Axnoy PO prints the same commercial GST summary as its source quote", () => {
  const summary = poCommercialSummary({
    subtotal: 29800,
    discount_total: 0,
    freight: 3500,
    other_charges: 0,
    tax_total: 5994,
    grand_total: 39294,
    freight_tax_type: "cgst_sgst",
    freight_tax_amount: 630,
    other_charges_tax_type: "none",
    other_charges_tax_amount: 0,
  }, [
    { tax_type: "cgst_sgst", tax_amount: 4680 },
    { tax_type: "cgst_sgst", tax_amount: 684 },
  ]);
  assert.equal(summary.beforeGst, 33300);
  assert.equal(summary.itemGst, 5364);
  assert.equal(summary.freightGst, 630);
  assert.equal(summary.cgst, 2997);
  assert.equal(summary.sgst, 2997);
  assert.equal(summary.igst, 0);
  assert.equal(summary.recordedGst, 5994);
  assert.equal(summary.grandTotal, 39294);
  assert.equal(summary.difference, 0);
  assert.equal(summary.gstDifference, 0);
});

test("old POs without freight GST remain unchanged", () => {
  const summary = poCommercialSummary({
    subtotal: 1000, discount_total: 20, freight: 100, other_charges: 0,
    tax_total: 176.4, grand_total: 1256.4,
  }, [{tax_amount:176.4,tax_type:"igst"}]);
  assert.equal(summary.beforeGst, 1080);
  assert.equal(summary.igst, 176.4);
  assert.equal(summary.freightGst, 0);
  assert.equal(summary.difference, 0);
});

test("odd-paise GST is split without losing a paise", () => {
  const summary = poCommercialSummary({
    subtotal: 100, discount_total: 0, freight: 0, other_charges: 0,
    tax_total: 5.01, grand_total: 105.01,
  }, [{tax_amount:5.01,tax_type:"cgst_sgst"}]);
  assert.equal(summary.cgst + summary.sgst, 5.01);
  assert.equal(summary.difference, 0);
});

test("incorrect stored grand or GST totals are flagged, not hidden as round-off", () => {
  const summary = poCommercialSummary({
    subtotal: 29800, discount_total: 0, freight: 3500, other_charges: 0,
    tax_total: 5364, grand_total: 39294,
    freight_tax_type: "cgst_sgst", freight_tax_amount: 0,
  }, [
    {tax_type:"cgst_sgst",tax_amount:4680},
    {tax_type:"cgst_sgst",tax_amount:684},
  ]);
  assert.equal(summary.grandTotal, 39294);
  assert.equal(summary.difference, 630);
  assert.equal(summary.gstDifference, 0);
});
