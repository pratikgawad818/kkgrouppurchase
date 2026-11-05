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

test("mixed construction invoices calculate line-wise unit rates independently",()=>{
  const items=[
    {id:"a",description:"Rebar steel",hsn_sac:"7214",unit:"MT",quantity:"13.250",rate:"48200",discount:"0",tax_rate:"18"},
    {id:"b",description:"Cement 53 grade",hsn_sac:"2523",unit:"Bag",quantity:"700",rate:"345.50",discount:"0",tax_rate:"28"},
    {id:"c",description:"Sand",hsn_sac:"",unit:"CFT",quantity:"100",rate:"55",discount:"0",tax_rate:"0"},
    {id:"d",description:"Electrician labour",hsn_sac:"",unit:"Day",quantity:"15",rate:"1250",discount:"500",tax_rate:"18"},
  ];
  const result=evaluateOpeningBill({...base,lines:items,payments:[],legacyPaid:0});
  assert.deepEqual(result.errors,[]);
  assert.equal(result.computed.length,4);
  assert.equal(result.computed[0].taxable,638650);
  assert.equal(result.computed[1].taxable,241850);
  assert.equal(result.computed[2].taxable,5500);
  assert.equal(result.computed[3].taxable,18250);
  assert.equal(result.subtotal,904250);
  assert.equal(result.taxTotal,185875);
  assert.equal(result.balance,1090225);
});
