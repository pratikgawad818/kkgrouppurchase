import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchesSmallExpenseVendor, smallExpenseVendorSuggestions, summarizeSmallExpenses }
  from "../../src/lib/small-expenses.ts";

const expenses = [
  {paid_to:"  Ravi Traders  ",status:"recorded",amount:1000,category:"hardware",project_id:"city",building_id:"one"},
  {paid_to:"ravi traders",status:"recorded",amount:500,category:"fuel",project_id:"city",building_id:"two"},
  {paid_to:"Shree Cement",status:"recorded",amount:2000,category:"hardware",project_id:"city",building_id:"one"},
  {paid_to:"Tanuj Worker",status:"recorded",amount:300,category:"office",project_id:null,building_id:null},
];

test("vendor-name search matches paid_to ignoring capitalization and surrounding whitespace",()=>{
  assert.equal(matchesSmallExpenseVendor("Ravi Traders","  rAvI "),true);
  assert.equal(matchesSmallExpenseVendor("Ravi Traders","traders"),true);
  assert.equal(matchesSmallExpenseVendor("Shree Cement","cement"),true);
  assert.equal(matchesSmallExpenseVendor("Shree Cement","ravi"),false);
  assert.equal(matchesSmallExpenseVendor(null,"ravi"),false);
  assert.equal(matchesSmallExpenseVendor(null,"  "),true);
});

test("vendor suggestions deduplicate case-insensitively and omit blank payees",()=>{
 const names=smallExpenseVendorSuggestions([
  ...expenses,{paid_to:" "},{paid_to:null},{paid_to:"Shree Cement"},
 ]);
 assert.equal(names.length,3);
 assert.deepEqual(new Set(names.map(name=>name.toLowerCase())),new Set(["ravi traders","shree cement","tanuj worker"]));
 assert.ok(names.some(name=>name==="Ravi Traders"));
});

test("vendor and project filters combine and summary reflects matching records, not page size",()=>{
 const filtered=expenses.filter(row=>
   matchesSmallExpenseVendor(row.paid_to,"RAVI")
   &&row.project_id==="city"
   &&row.category!=="office");
 const result=summarizeSmallExpenses(filtered);
 assert.equal(result.count,2);
 assert.equal(result.total,1500);
 assert.equal(result.byCategory.get("hardware"),1000);
 assert.equal(result.byCategory.get("fuel"),500);
 assert.equal(result.byProject.get("city"),1500);
});

test("Small Expenses route wires vendor filter into matching rows, summary and page-reset",()=>{
 const source=readFileSync("src/routes/_authenticated/_shell/finance.small-expenses.tsx","utf8");
 assert.match(source,/aria-label="Vendor name filter"/);
 assert.match(source,/placeholder="Search vendor \/ paid to"/);
 assert.match(source,/list="small-expense-vendor-suggestions"/);
 assert.match(source,/vendorSuggestions\.map\(/);
 assert.match(source,/matchesSmallExpenseVendor\(x\.paid_to,vendorFilter\)/);
 assert.match(source,/setVendorFilter\(e\.target\.value\);setPage\(0\)/);
 assert.match(source,/const total=summarizeSmallExpenses\(rows\)/);
 assert.match(source,/const pageRows=rows\.slice/);
});
