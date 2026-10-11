import test from "node:test";
import assert from "node:assert/strict";
import { parseSmallExpenseAmount, summarizeSmallExpenses } from "../../src/lib/small-expenses.ts";
test("positive rupees and at most 2 decimal places, capped at 50000",()=>{
  assert.equal(parseSmallExpenseAmount("50"),50);
  assert.equal(parseSmallExpenseAmount("120.75"),120.75);
  assert.equal(parseSmallExpenseAmount("50000.00"),50000);
  for(const invalid of ["0","-1","0.00","0.001","9e9","1,000","50000.01","99999999","abc"])assert.equal(parseSmallExpenseAmount(invalid),null,invalid);
});
test("voided expenses excluded from live actual expense totals; project/building grouping",()=>{
  const rows=[
    {status:"recorded",amount:100,category:"fuel",project_id:"p1",building_id:"b1"},
    {status:"recorded",amount:25.5,category:"tea_food",project_id:"p1",building_id:"b2"},
    {status:"recorded",amount:40,category:"office",project_id:null,building_id:null},
    {status:"voided",amount:999,category:"fuel",project_id:"p1",building_id:"b1"},
  ];
  const s=summarizeSmallExpenses(rows);
  assert.equal(s.total,165.5);assert.equal(s.count,3);assert.equal(s.voided,1);
  assert.equal(s.byProject.get("p1"),125.5);
  assert.equal(s.byBuilding.get("b1"),100);
  assert.equal(s.byProject.get("office"),40);
  assert.equal(s.byCategory.get("fuel"),100);
});
