import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {financeWorkbook} from "../../src/lib/finance-workbook.ts";

function entries(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const end=bytes.length-22;
 assert.equal(view.getUint32(end,true),0x06054b50);
 const count=view.getUint16(end+10,true);
 let cursor=view.getUint32(end+16,true);
 const files=new Map();
 const decode=new TextDecoder();
 for(let i=0;i<count;i++){
   assert.equal(view.getUint32(cursor,true),0x02014b50);
   const size=view.getUint32(cursor+20,true),len=view.getUint16(cursor+28,true);
   const path=decode.decode(bytes.subarray(cursor+46,cursor+46+len));
   const local=view.getUint32(cursor+42,true);
   assert.equal(view.getUint32(local,true),0x04034b50);
   assert.equal(view.getUint16(local+8,true),0);
   const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
   const data=bytes.subarray(start,start+size);
   let crc=0xffffffff;
   for(const b of data){crc^=b;for(let j=0;j<8;j++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;}
   assert.equal((crc^0xffffffff)>>>0,view.getUint32(cursor+16,true));
   files.set(path,decode.decode(data));
   cursor+=46+len+view.getUint16(cursor+30,true)+view.getUint16(cursor+32,true);
 }
 assert.equal(cursor,end);
 return files;
}
test("native OOXML ZIP has valid entries, typed amounts, frozen header and filters",()=>{
 const files=entries(financeWorkbook(["Bill","Vendor","Amount"],[["00001","A & B <Trader>",1234.56],["=SUM(1,2)","मराठी",-50.5]]));
 assert.equal(files.size,6);
 assert.ok(files.has("[Content_Types].xml"));
 assert.ok(files.has("xl/_rels/workbook.xml.rels"));
 const sheet=files.get("xl/worksheets/sheet1.xml");
 assert.match(sheet,/<c r="C2" s="2"><v>1234.56<\/v><\/c>/);
 assert.match(sheet,/<c r="C3" s="2"><v>-50.5<\/v><\/c>/);
 assert.match(sheet,/<c r="A2" t="inlineStr"[^>]*><is><t[^>]*>00001<\/t>/);
 assert.ok(sheet.includes("A &amp; B &lt;Trader&gt;"));
 assert.ok(sheet.includes("मराठी"));
 assert.ok(sheet.includes("=SUM(1,2)"));
 assert.doesNotMatch(sheet,/<f(?:\s|>)/);
 assert.ok(sheet.includes('autoFilter ref="A1:C3"'));
 assert.ok(sheet.includes('state="frozen"'));
});
test("all text, including formula-like values, stays literal and invalid exports fail closed",()=>{
 const files=entries(financeWorkbook(["Text"],[["@SUM(A1)"],["+cmd"],["-1+2"],["\u0001hidden"],["_x0041_"]]));
 const sheet=files.get("xl/worksheets/sheet1.xml");
 assert.doesNotMatch(sheet,/<f(?:\s|>)/);
 assert.ok(sheet.includes("_x005F_x0041_"));
 assert.ok(!sheet.includes("\u0001"));
 assert.throws(()=>financeWorkbook(["Amount"],[[NaN]]),/Invalid financial amount/);
 assert.throws(()=>financeWorkbook(["A","B"],[["A"]]),/column mismatch/);
 assert.throws(()=>financeWorkbook([],[]),/size/);
});
test("finance exports use complete filtered rows, not pagination or unapproved storage data",()=>{
 const ui=readFileSync("src/components/erp/finance-export.tsx","utf8");
 assert.ok(ui.includes('r==="super_admin"||r==="accounts_manager"||r==="director"'));
 assert.ok(ui.includes("profile.is_active"));
 assert.ok(ui.includes("disabled={!ready||!count}"));
 for(const route of ["finance.vendor-invoices.index.tsx","finance.payments.index.tsx","finance.payables.tsx","finance.small-expenses.tsx"]){
   const source=readFileSync("src/routes/_authenticated/_shell/"+route,"utf8");
   assert.ok(source.includes("<FinanceExport"),route);
   assert.ok(source.includes("count={rows.length}"),route);
   assert.ok(source.includes("rows={()=>rows.map"),route);
   assert.doesNotMatch(source.match(/<FinanceExport[\s\S]*?\/>/)?.[0]??"",/pageRows|bank_account_number|proof_path|storage_path/);
 }
 const ledger=readFileSync("src/routes/_authenticated/_shell/finance.vendor-ledger.tsx","utf8");
 assert.ok(ledger.includes("...inFy.map"));
 assert.ok(ledger.includes("Closing balance for selected FY"));
 assert.ok(ledger.includes("inFy.at(-1)?.bal??opening"));
});
