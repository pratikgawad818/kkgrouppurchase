import test from "node:test";
import assert from "node:assert/strict";
import { chargeGst, lineCalc } from "../../src/lib/rfq.ts";

test("supplier Axnoy quotation totals ₹39,294 including GST on freight", () => {
  const speedBreakers = lineCalc(20, 1300, 0, 18, "cgst_sgst");
  const endCaps = lineCalc(8, 475, 0, 18, "cgst_sgst");
  assert.equal(speedBreakers.taxable + endCaps.taxable, 29800);
  assert.equal(speedBreakers.tax + endCaps.tax, 5364);
  const freightTax = chargeGst(3500, "cgst_sgst", 18);
  assert.equal(freightTax, 630);
  assert.equal(speedBreakers.total + endCaps.total + 3500 + freightTax, 39294);
});

test("untaxed freight preserves legacy amounts and other charges are independently taxable", () => {
  assert.equal(chargeGst(3500, "none", 0), 0);
  assert.equal(chargeGst(3500, "none", 18), 0);
  assert.equal(chargeGst(42, "igst", 18), 7.56);
  assert.equal(chargeGst(0, "cgst_sgst", 18), 0);
  assert.equal(chargeGst(123.45, "cgst_sgst", 12), 14.81);
});

test("invalid money, GST rate or tax type cannot silently enter a quote", () => {
  assert.throws(() => chargeGst(-1, "cgst_sgst", 18));
  assert.throws(() => chargeGst(Number.NaN, "cgst_sgst", 18));
  assert.throws(() => chargeGst(1, "cgst_sgst", 100));
  assert.throws(() => chargeGst(1, "unknown", 18));
});
