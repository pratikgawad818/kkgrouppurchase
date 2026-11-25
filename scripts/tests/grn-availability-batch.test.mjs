import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {collectGrnAvailability} from "../../src/lib/grn-availability-collect.ts";
const ids=Array.from({length:501},(_,i)=>"id-"+i);
test("501 goods receipt lines need only three bounded quantity requests",async()=>{
 const calls=[];
 const result=await collectGrnAvailability(ids,async batch=>{
   calls.push(batch.length);
   return {data:batch.map(grn_item_id=>({grn_item_id,available:12.5})).reverse(),error:null};
 });
 assert.deepEqual(calls,[250,250,1]);
 assert.equal(result.size,501);
 assert.equal(result.get("id-500"),12.5);
});
test("inaccessible or incomplete results cannot be used to create an invoice",async()=>{
 for(const data of [[],[{grn_item_id:"a",available:null}],[{grn_item_id:"b",available:1}],[{grn_item_id:"a",available:"NaN"}]]){
  await assert.rejects(collectGrnAvailability(["a"],async()=>({data,error:null})),/incomplete|invalid or inaccessible/);
 }
 await assert.rejects(collectGrnAvailability(["a","a"],async()=>({data:[],error:null})),/duplicate/);
 await assert.rejects(collectGrnAvailability(["a"],async()=>({data:null,error:{message:"denied"}})),/denied/);
});
test("empty GRNs issue no availability requests",async()=>{
 assert.equal((await collectGrnAvailability([],async()=>{throw Error("must not call");})).size,0);
});
test("batch RPC reuses existing authorization and form loads complete PO and GRN rows",()=>{
 const sql=readFileSync("drizzle/migrations/0120_batch_grn_availability.sql","utf8");
 assert.ok(sql.includes("SECURITY INVOKER"));
 assert.ok(sql.includes("public.grn_item_available(ids.id,_exclude_invoice)"));
 assert.ok(sql.includes("FROM PUBLIC,anon"));
 const page=readFileSync("src/routes/_authenticated/_shell/finance.vendor-invoices.new.tsx","utf8");
 assert.ok(page.includes('loadCompleteRows(async (start,end)=>await supabase.from("goods_receipt_items")'));
 assert.ok(page.includes('loadCompleteRows(async (start,end)=>await supabase.from("purchase_orders")'));
 assert.ok(page.includes("loadBatchedGrnAvailability(data.map(g=>g.id),editId??null)"));
 assert.doesNotMatch(page,/\.map\(\(g\) => supabase\.rpc\("grn_item_available"/);
});
