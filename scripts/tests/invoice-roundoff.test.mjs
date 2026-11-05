import test from "node:test";
import assert from "node:assert/strict";
import { optionalInvoiceRoundOff, toPaise } from "../../src/lib/invoice-roundoff.ts";

test("round-off is opt-in, even when invoice contains fractional paise", () => {
  for (const amount of [0.01,12.75,100.5,12345.99]) {
    assert.equal(optionalInvoiceRoundOff(amount,"none"),0);
  }
});
test("opt-in nearest whole rupee is a separately signed adjustment, never a hidden rate change",()=>{
  assert.equal(optionalInvoiceRoundOff(123.25,"nearest_rupee"),-0.25);
  assert.equal(optionalInvoiceRoundOff(123.50,"nearest_rupee"),0.50);
  assert.equal(optionalInvoiceRoundOff(123.75,"nearest_rupee"),0.25);
  assert.equal(optionalInvoiceRoundOff(123.00,"nearest_rupee"),0);
  assert.equal(optionalInvoiceRoundOff(4100.09,"nearest_rupee"),-0.09);
});
test("taxable and TDS paise remain independently calculated and auditably exact",()=>{
  const taxable=toPaise(1.125*190);
  const tax=toPaise(1.125*190*0.18);
  const gross=toPaise(taxable+tax);
  const adjustment=optionalInvoiceRoundOff(gross,"nearest_rupee");
  assert.equal(taxable,213.75);
  assert.equal(tax,38.48);
  assert.equal(gross,252.23);
  assert.equal(adjustment,-0.23);
  assert.equal(toPaise(gross+adjustment),252);
});
test("invalid gross values cannot be rounded",()=>{
  assert.throws(()=>optionalInvoiceRoundOff(Number.NaN,"nearest_rupee"),/Invalid/);
  assert.throws(()=>optionalInvoiceRoundOff(-1,"nearest_rupee"),/Invalid/);
});
