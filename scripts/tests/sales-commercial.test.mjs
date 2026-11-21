import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseCsv,csvExport,readFlatSpreadsheet,SALES_HEADERS} from "../../src/lib/sales-spreadsheet.ts";

const template=[...SALES_HEADERS].join(",")+"\n"+
  "1,101,2bhk,500,600,700,2200,0,0,5\n";
test("Excel-compatible CSV parser handles quoted commas, quotes and linebreaks",()=>{
 assert.deepEqual(parseCsv('name,notes\r\n"Alpha, Tower","Floor ""1""\nand two"\r\n'),
  [["name","notes"],["Alpha, Tower",'Floor "1"\nand two']]);
});
test("CSV export escapes formulas and protects Excel from formula injection",()=>{
 const output=csvExport([["Project","Ref"],["=HYPERLINK(\"evil\")","+RUN"],
  ["-cmd","@sum"],["Normal","Tower"]]);
 assert.ok(output.startsWith("\uFEFF"));
 assert.match(output,/'=HYPERLINK/);
 assert.match(output,/"'\+RUN"/);
 assert.match(output,/"'-cmd"/);
 assert.match(output,/"'@sum"/);
});
test("user can parse the published CSV flat import template",async()=>{
 const file=new File([template],"flats.csv",{type:"text/csv"});
 const rows=await readFlatSpreadsheet(file);
 assert.equal(rows.length,1);
 assert.equal(rows[0].flat_number,"101");
 assert.equal(rows[0].saleable_area,"700");
});
test("bad/missing columns or oversize batches fail without silent truncation",async()=>{
 await assert.rejects(readFlatSpreadsheet(new File(["foo,bar\n1,2\n"],"wrong.csv")),/Missing spreadsheet columns/);
 const invalid=new File([template+"2,201,2bhk,0,600,700,2200,0,0,5"],"invalid.csv");
 await assert.rejects(readFlatSpreadsheet(invalid),/invalid carpet_area/);
 const many=new File([[...SALES_HEADERS].join(","),...Array.from({length:301},
  (_,i)=>`1,${i+1},2bhk,500,600,700,2200,0,0,5`)].join("\n"),"many.csv");
 await assert.rejects(readFlatSpreadsheet(many),/300/);
});
test("commercial migration keeps write operations in authorized RPCs",()=>{
 const sql=readFileSync("drizzle/migrations/0097_sales_buyers_milestones_documents.sql","utf8");
 assert.match(sql,/sales_doc_access\(name,true\)/);
 assert.match(sql,/sales_project_allowed\(s\.project_id\)/);
 assert.match(sql,/REVOKE ALL ON public\.property_sale_buyer_details/);
 assert.match(sql,/CREATE POLICY "Assigned sales documents"/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.sales_set_payment_plan/);
});
