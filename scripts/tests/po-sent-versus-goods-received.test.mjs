import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canConfirmPoSentToSupplier } from "../../src/lib/po-supplier-dispatch.ts";

const route = readFileSync(
  new URL("../../src/routes/_authenticated/_shell/procurement.purchase-orders.$id.tsx",import.meta.url),
  "utf8",
);
const allowed = (poStatus, challans=[],grns=[],canManage=true) =>
  canConfirmPoSentToSupplier(poStatus,canManage,challans,grns);

test("PO-2026-0004: 8 registered supplier challans hide redundant Mark as sent",()=>{
  const eightChallans=Array.from({length:8},()=>({status:"registered"}));
  assert.equal(allowed("approved",eightChallans),false);
  assert.equal(allowed("approved",[...eightChallans], [{status:"draft"}]),false);
});

test("manual PO dispatch remains optional only before any supplier delivery",()=>{
  assert.equal(allowed("approved"),true);
  assert.equal(allowed("approved",[{status:"cancelled"}],[{status:"cancelled"}]),true);
  assert.equal(allowed("approved",[{status:"registered"}]),false);
  assert.equal(allowed("approved",[],[{status:"draft"}]),false);
  assert.equal(allowed("approved",[],[{status:"posted"}]),false);
  for(const status of ["draft","pending_approval","sent","partially_received","partially_accepted","fully_received","closed","cancelled"]){
    assert.equal(allowed(status),false,status);
  }
  assert.equal(allowed("approved",[],[],false),false);
});

test("PO page separates optional supplier dispatch from goods receiving",()=>{
  assert.match(route,/canConfirmPoSentToSupplier\(/);
  assert.match(route,/Supplier communication \(optional\)/);
  assert.match(route,/Confirm PO sent to supplier/);
  assert.match(route,/You do not need to mark it as sent before registering a vendor challan or receiving goods/);
  assert.match(route,/canRecordPoSent &&/);
  assert.match(route,/\.includes\(po\.status\) &&\s*can\("grn.create"\)/);
  assert.match(route,/Register vendor challan/);
  assert.match(route,/Receive goods/);
  assert.doesNotMatch(route,/>\s*Mark as sent\s*</);
});
