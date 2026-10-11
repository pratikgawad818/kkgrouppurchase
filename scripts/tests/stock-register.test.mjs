import test from "node:test";
import assert from "node:assert/strict";
import { loadCompleteRows } from "../../src/lib/complete-register.ts";
import { filteredStockSummary, stockLevel } from "../../src/lib/stock-register.ts";

const stock=(i)=>({
  id:"row-"+i,
  warehouse_id: i%2===0?"store-a":"store-b",
  material_id:"material-"+i,
  quantity_on_hand:i%3===0?0:i%3===1?2:20,
  total_value:i+0.5,
  items:{name:"Cement "+i,code:"CEM-"+i,reorder_level:5},
});

test("2001 stock lines are all loaded, rather than silently capped at 2000",async()=>{
  const data=Array.from({length:2001},(_,i)=>stock(i));
  let calls=0;
  const rows=await loadCompleteRows(async(start,end)=>{
    calls++;
    return {data:data.slice(start,end+1),count:data.length,error:null};
  },{pageSize:250,maxRows:10000});
  assert.equal(rows.length,2001);
  assert.equal(calls,9);
  const summary=filteredStockSummary(rows,"","cement");
  assert.equal(summary.rows.length,2001);
  assert.equal(summary.out,667);
  assert.equal(summary.low,667);
  assert.equal(summary.totalValue,2001*2001/2);
});

test("store and material filtering leaves low/out and values consistent",()=>{
  const data=[stock(0),stock(1),stock(2)];
  const summary=filteredStockSummary(data,"store-a","CEM");
  assert.equal(summary.rows.length,2);
  assert.equal(summary.out,1);
  assert.equal(summary.low,0);
  assert.equal(summary.totalValue,0.5+2.5);
  assert.equal(stockLevel(stock(1)),"low");
});

test("incomplete page / exceeding browser bound does not return misleading totals",async()=>{
  const data=Array.from({length:251},(_,i)=>stock(i));
  await assert.rejects(loadCompleteRows(async(start,end)=>
    ({data:data.slice(start,Math.min(end+1,200)),count:251,error:null}),{pageSize:250,maxRows:500}),/incomplete/);
  await assert.rejects(loadCompleteRows(async()=>({data:[],count:10001,error:null}),{maxRows:10000}),/browser safety limit/);
  assert.throws(()=>filteredStockSummary([{...stock(1),total_value:NaN}],"",""),/invalid/);
});
