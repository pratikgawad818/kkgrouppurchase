import test from "node:test";
import assert from "node:assert/strict";
import {salesToday,salesPeriodRange,validSalesRange,summarizeSalesPeriod,summarizeFlatInventory} from "../../src/lib/sales-period-dashboard.ts";
test("inclusive IST date windows and leap year",()=>{
 assert.equal(salesToday(new Date("2026-11-27T19:00:00Z")),"2026-11-28");
 assert.deepEqual(salesPeriodRange("month","2026-11-28"),{from:"2026-11-01",to:"2026-11-28"});
 assert.deepEqual(salesPeriodRange("3m","2026-11-28"),{from:"2026-08-29",to:"2026-11-28"});
 assert.deepEqual(salesPeriodRange("6m","2026-11-28"),{from:"2026-05-29",to:"2026-11-28"});
 assert.deepEqual(salesPeriodRange("1y","2024-02-29"),{from:"2023-03-01",to:"2024-02-29"});
 assert.equal(validSalesRange({from:"2026-02-30",to:"2026-11-28"},"2026-11-28"),false);
});
test("sale, payment and expense dates independent; charts reconcile to totals",()=>{
 const range={from:"2026-10-01",to:"2026-11-28"};
 const sale=(id,status,booked_on)=>({id,project_id:"a",status,booked_on,final_sale_price:100000});
 const exp=(id,status,spent_on,category)=>({id,project_id:"a",status,spent_on,category,amount:12.34});
 const r=summarizeSalesPeriod(["a"],range,[sale("1","registered","2026-10-01"),sale("2","cancelled","2026-11-28"),sale("3","booked","2026-09-30")],[exp("1","recorded","2026-11-28","Marketing"),exp("2","void","2026-11-01","Marketing")],[{id:"1",project_id:"a",status:"verified",paid_on:"2026-11-28",amount:500}]);
 assert.equal(r.total.bookings,1);assert.equal(r.total.bookedValue,10000000);assert.equal(r.total.cancelled,1);
 assert.equal(r.total.expenses,1234);assert.equal(r.total.verified,50000);
 assert.equal(r.months.get("2026-10").bookedValue,10000000);assert.equal(r.months.get("2026-11").expenses,1234);assert.equal(r.categories.get("Marketing"),1234);
 assert.throws(()=>summarizeSalesPeriod(["b"],range,[sale("1","registered","2026-10-01")],[],[]),/outside/);
});
test("unsold snapshot separates available and hold from bookings and registered flats",()=>{
 const rows=["available","hold","booked","agreement_done","registered","possession_completed","cancelled"].map((status,i)=>({id:String(i),project_id:"a",status}));
 const r=summarizeFlatInventory(["a"],rows);
 assert.deepEqual(r.total,{available:1,hold:1,inProgress:2,sold:2,cancelled:1,total:7,unsold:2});
 assert.equal(r.projects.get("a").unsold,2);
 assert.throws(()=>summarizeFlatInventory(["b"],rows),/unassigned/);
});
