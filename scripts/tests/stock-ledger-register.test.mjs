import test from "node:test";
import assert from "node:assert/strict";
import { loadCompleteRows } from "../../src/lib/complete-register.ts";
import { filterStockLedger } from "../../src/lib/stock-ledger-filter.ts";
const row = i => ({
  id: "tx-"+String(i).padStart(5,"0"),
  warehouse_id: i%2 ? "WH2" : "WH1",
  project_id: i%3 ? "PROJECT1" : null,
  building_id: i%3 ? "BUILDING_A" : null,
  tx_type: i%2 ? "material_issue" : "goods_receipt",
  tx_date: i%2 ? "2026-10-11" : "2026-10-09",
  items: {name: i%2 ? "Cement" : "Steel",code:i%2 ? "CEM" : "STL"},
  goods_receipt_notes: i%2 ? null : {grn_number:"GRN-"+i},
  stock_transfers:null,stock_adjustments:null,
  material_issues:i%2 ? {issue_number:"MI-"+i} : null,material_returns:null,
});

test("ledger reads ALL 3001 rows rather than truncating at 3000",async()=>{
  const source=Array.from({length:3001},(_,i)=>row(i));
  const rows=await loadCompleteRows(async(start,end)=>({
    data:source.slice(start,end+1),count:source.length,error:null,
  }),{pageSize:250,maxRows:10000});
  assert.equal(rows.length,3001);
  assert.equal(rows.at(-1).id,"tx-03000");
  const filtered=filterStockLedger(rows,{
    wh:"WH2", project:"PROJECT1",building:"BUILDING_A",
    type:"material_issue",from:"2026-10-10",to:"2026-10-12",
  },"CeMeNt");
  assert.ok(filtered.length>0);
  assert.ok(filtered.every(r=>r.warehouse_id==="WH2"&&r.items.name==="Cement"&&r.project_id==="PROJECT1"));
});

test("searches ledger references and respects inclusive date boundaries",()=>{
  const all=[row(0),row(1),row(2)];
  const blank={wh:"",project:"",building:"",type:"",from:"",to:""};
  assert.deepEqual(filterStockLedger(all,blank,"GRN-0").map(x=>x.id),["tx-00000"]);
  assert.deepEqual(filterStockLedger(all,blank,"MI-1").map(x=>x.id),["tx-00001"]);
  assert.deepEqual(filterStockLedger(all,{...blank,from:"2026-10-11",to:"2026-10-11"},"").map(x=>x.id),["tx-00001"]);
});

test("incomplete/mutating page fails closed rather than dropping movements",async()=>{
  const source=Array.from({length:260},(_,i)=>row(i));
  await assert.rejects(loadCompleteRows(async(start,end)=>({
    data:source.slice(start,Math.min(end+1,200)),count:source.length,error:null,
  }),{pageSize:250}),/incomplete/);
  await assert.rejects(loadCompleteRows(async(start,end)=>({
    data:source.slice(start,end+1),count:start>0?261:260,error:null,
  }),{pageSize:250}),/changed during loading/);
});
