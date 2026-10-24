import test from "node:test";
import assert from "node:assert/strict";
import { SHEET_ENTRY_TABS, parseEntrySheet, parseClipboardGrid } from "../../src/lib/google-sheets-model.ts";
const header=(kind)=>[...SHEET_ENTRY_TABS.find(t=>t.kind===kind).headers];
const costing=["LEGACY-COST-1","2026-01-04","PROJ-A","BLDG-A","labour","","Contractor day work","10","250","2500","","cash","Verified"];
const challan1=["CH-001","D-45","2026-03-05","V-01","PO-2026-004","PROJ-A","BLDG-A","1","CEMENT","100","MH-01","",""];
const challan2=["CH-001","","","","","","","2","STEEL","40","","",""];
const invoice1=["INV-01","V-BILL-2","2026-03-07","2026-03-15","V-01","PO-2026-004","GRN-100","1","CEMENT","100","350","cgst_sgst","18","100","0","","0","approved for draft only"];
const invoice2=["INV-01","","","","","","GRN-101","1","STEEL","10","200","igst","18","","","","",""];
test("costing template parses distinct historical project cost, not stock or payable",()=>{
  const {documents,errors}=parseEntrySheet("costing",[header("costing"),costing]);
  assert.deepEqual(errors,[]);assert.equal(documents.length,1);
  assert.equal(documents[0].reference,"LEGACY-COST-1");
  assert.deepEqual(documents[0].rows,[2]);
  assert.equal(documents[0].payload.amount,2500);
});
test("multi-line challan is grouped by stable import reference and PO line",()=>{
  const out=parseEntrySheet("challan",[header("challan"),challan1,challan2]);
  assert.deepEqual(out.errors,[]);assert.equal(out.documents.length,1);
  assert.deepEqual(out.documents[0].rows,[2,3]);
  assert.equal(out.documents[0].payload.items.length,2);
});
test("duplicate PO line and mismatched header are rejected for entire challan",()=>{
  for(const change of [{idx:7,value:"1"},{idx:3,value:"OTHER-VENDOR"}]){
    const copy=[...challan2];copy[change.idx]=change.value;
    const out=parseEntrySheet("challan",[header("challan"),challan1,copy]);
    assert.equal(out.documents.length,0);
    assert.deepEqual(out.errors.map(x=>x.row),[2,3]);
  }
});
test("invoice with two GRNs is staged as one draft with freight charged once",()=>{
  const out=parseEntrySheet("invoice",[header("invoice"),invoice1,invoice2]);
  assert.deepEqual(out.errors,[]);assert.equal(out.documents.length,1);
  assert.equal(out.documents[0].payload.freight,100);
  assert.equal(out.documents[0].payload.items.length,2);
});
test("invoice validates tax type and prevents repeated fees",()=>{
  const badTax=[...invoice2];badTax[11]="cheat";
  assert.equal(parseEntrySheet("invoice",[header("invoice"),invoice1,badTax]).errors.length,2);
  const badFees=[...invoice2];badFees[13]="50";
  assert.equal(parseEntrySheet("invoice",[header("invoice"),invoice1,badFees]).errors.length,2);
});
test("costing entry rejects blank dates, negative and mismatched INR, duplicate reference",()=>{
  for(const update of [{idx:1,value:"2026-02-30"},{idx:9,value:"-10"},{idx:9,value:"2600"},{idx:9,value:"0"}]){
    const row=[...costing];row[update.idx]=update.value;
    assert.deepEqual(parseEntrySheet("costing",[header("costing"),row]).documents,[]);
  }
  const duplicate=parseEntrySheet("costing",[header("costing"),costing,costing]);
  assert.equal(duplicate.documents.length,0);
  assert.deepEqual(duplicate.errors.map(e=>e.row),[2,3]);
});
test("reserved import headers must match exactly; trailing status fields never become payload",()=>{
  assert.throws(()=>parseEntrySheet("invoice",[["bad","headers"],invoice1]),/header/);
  const statusRow=[...costing];statusRow[13]="not-real-uuid";statusRow[14]="APPLIED";statusRow[15]="ignored";
  const out=parseEntrySheet("costing",[header("costing"),statusRow]);
  assert.deepEqual(out.errors,[]);
  assert.equal("erp_record_id" in out.documents[0].payload,false);
});

test("Google Sheets clipboard TSV preserves quoted tabs, embedded newlines, CRLF and trailing cells",()=>{
  const clip='Ref\tDescription\tTotal\r\nC-1\t"Project ""A"", Phase\t2\nRework"\t120.00\r\nC-2\tNormal\t5\r\n';
  assert.deepEqual(parseClipboardGrid(clip),[
    ["Ref","Description","Total"],["C-1",'Project "A", Phase\t2\nRework',"120.00"],
    ["C-2","Normal","5"],
  ]);
});
test("clipboard rejects missing rows, invalid quotes and oversized input",()=>{
  assert.throws(()=>parseClipboardGrid(""),/Copy/);
  assert.throws(()=>parseClipboardGrid("Header only"),/header row/);
  assert.throws(()=>parseClipboardGrid('H1\tH2\nA\t"never closed'),/Unclosed/);
  assert.throws(()=>parseClipboardGrid("a\tb\n"+("x\t1\n").repeat(501)),/500 data rows/);
  assert.throws(()=>parseClipboardGrid("a\tb\n"+("x".repeat(200001))),/too large/);
});
test("clipboard copying full costing worksheet can be parsed for staged review",()=>{
  const copied=[header("costing").join("\t"),costing.join("\t")].join("\n");
  const result=parseEntrySheet("costing",parseClipboardGrid(copied));
  assert.equal(result.documents.length,1);
  assert.deepEqual(result.errors,[]);
});
