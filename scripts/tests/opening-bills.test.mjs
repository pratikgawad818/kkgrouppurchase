import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOpeningBill, isRealDate } from "../../src/lib/opening-bills.ts";

const base = {
  lines:[{id:"a",description:"Cement",hsn_sac:"2523",unit:"Bag",quantity:"10",rate:"350",discount:"100",tax_rate:"18"}],
  payments:[{id:"p",payment_date:"2026-10-01",payment_mode:"upi",reference:"UTR-A",amount:"2000",remarks:"Paid before ERP"}],
  gstType:"cgst_sgst",freight:"100",otherCharges:"0",tdsRate:"0",legacyPaid:0,
};
test("old supplier bill amounts are calculated from item rows, GST, and past payments",()=>{
  const result=evaluateOpeningBill(base);
  assert.deepEqual(result.errors,[]);
  assert.equal(result.subtotal,3400);
  assert.equal(result.taxTotal,612);
  assert.equal(result.gross,4112);
  assert.equal(result.net,4112);
  assert.equal(result.paid,2000);
  assert.equal(result.balance,2112);
});
test("preserve original paid amount when itemizing pre-upgrade opening bills",()=>{
  const result=evaluateOpeningBill({...base,legacyPaid:1000});
  assert.deepEqual(result.errors,[]);
  assert.equal(result.balance,1112);
});
test("refuse overpayment, negative rate, future historical payment and no-GST taxed line",()=>{
  assert.match(evaluateOpeningBill({...base,payments:[{...base.payments[0],amount:"5000"}]}).errors.join(" " ),/cannot exceed/);
  assert.match(evaluateOpeningBill({...base,lines:[{...base.lines[0],rate:"-1"}]}).errors.join(" "),/valid rate/);
  assert.match(evaluateOpeningBill({...base,payments:[{...base.payments[0],payment_date:"2099-01-01"}]}).errors.join(" "),/future/);
  assert.match(evaluateOpeningBill({...base,gstType:"none"}).errors.join(" "),/non-GST/);
});
test("validates real dates and maximum three quantity decimals",()=>{
  assert.equal(isRealDate("2026-02-30"),false);
  assert.equal(isRealDate("2026-02-28"),true);
  assert.match(evaluateOpeningBill({...base,lines:[{...base.lines[0],quantity:"1.1234"}]}).errors.join(" "),/max 3 decimals/);
});
