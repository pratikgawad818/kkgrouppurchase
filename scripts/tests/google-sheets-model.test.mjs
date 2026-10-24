import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSpreadsheetId, parseHistoricalRow, canonicalHistorical,
  decideHistoricalConflict, EXPORT_TABS, HISTORICAL_TAB,
} from "../../src/lib/google-sheets-model.ts";
const example=[
  "LEGACY-001","2025-05-15","PROJ-A","TOWER-A","CEMENT-OPC",
  "500","350","Old slab work","","","",
];
test("accepts full Google Sheets URL, never arbitrary URLs or bare IDs",()=>{
  const id="1AbCdEfGhIjKlMnOpQrStUvWxYz0123456";
  assert.equal(parseSpreadsheetId("https://docs.google.com/spreadsheets/d/"+id+"/edit#gid=0"),id);
  for(const url of ["https://example.com/spreadsheets/d/"+id+"/edit",
    "https://docs.google.com.evil.com/spreadsheets/d/"+id+"/edit",
    id,"https://docs.google.com/spreadsheets/d/abc/edit"])
    assert.throws(()=>parseSpreadsheetId(url));
});
test("historic row validation permits exact old usage, rejects invalid quantities and dates",()=>{
  const r=parseHistoricalRow(example);
  assert.equal(r.quantity,500); assert.equal(r.unitCost,350);
  assert.equal(r.projectCode,"PROJ-A");
  assert.deepEqual(JSON.parse(canonicalHistorical(r)).slice(0,2),["LEGACY-001","2025-05-15"]);
  const failed=[
    {index:0,value:"a bad key"},{index:1,value:"2025-02-30"},
    {index:2,value:""},{index:4,value:""},{index:5,value:"0"},
    {index:5,value:"-20"},{index:5,value:"1.00001"},{index:6,value:"-10"},
    {index:6,value:"Infinity"},{index:6,value:"12.567"},
  ];
  for(const {index,value} of failed){
    const candidate=[...example];candidate[index]=value;
    assert.throws(()=>parseHistoricalRow(candidate),String(index)+": "+value);
  }
});
test("two-sided edits conflict; stable or single-sided edits proceed without silent overwrite",()=>{
  assert.equal(decideHistoricalConflict(null,null,"A"),"import");
  assert.equal(decideHistoricalConflict("A","A","A"),"unchanged");
  assert.equal(decideHistoricalConflict("A","A","B"),"import");
  assert.equal(decideHistoricalConflict("A","B","A"),"export");
  assert.equal(decideHistoricalConflict("A","B","C"),"conflict");
  assert.equal(decideHistoricalConflict(null,"A","B"),"conflict");
});
test("only controlled history tab is bidirectional; exports never mirror arbitrary database tables",()=>{
  assert.equal(HISTORICAL_TAB,"ERP - Historical Consumption");
  for(const tab of EXPORT_TABS){
    assert.match(tab.name,/^ERP - /);
    assert.match(tab.table,/^[a-z_]+$/);
    assert.match(tab.columns,/^[a-z_,]+$/);
    assert.notEqual(tab.table,"inventory_transactions");
    assert.notEqual(tab.table,"journal_entries");
    assert.notEqual(tab.table,"user_roles");
  }
});
