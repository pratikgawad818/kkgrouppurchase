import React from "react";
import { createRoot } from "react-dom/client";
import { SalesDashboardSummary } from "../../../src/components/erp/sales-dashboard-summary";
import { summarizeFlatInventory,summarizeSalesPeriod } from "../../../src/lib/sales-period-dashboard";
const ids=["a","b"],selected=[{id:"a",name:"City Centre — Tower A and B"},{id:"b",name:"Crescent Point-II"}];
const statuses=["available","hold","booked","agreement_pending","registered","possession_completed","cancelled"];
const inventory=summarizeFlatInventory(ids,Array.from({length:125},(_,i)=>({id:String(i),project_id:ids[i%2]!,status:statuses[i%statuses.length]!})));
const report=summarizeSalesPeriod(ids,{from:"2025-12-01",to:"2026-11-30"},Array.from({length:12},(_,i)=>({id:String(i),project_id:ids[i%2]!,booked_on:"2026-01-01",status:"registered",final_sale_price:98765432.10})),Array.from({length:12},(_,i)=>({id:String(i),project_id:ids[i%2]!,spent_on:"2026-"+String(i%11+1).padStart(2,"0")+"-01",status:"recorded",amount:123456.78,category:i%2?"Marketing":"Consultancy"})),[{id:"1",project_id:"a",paid_on:"2026-11-01",status:"verified",amount:12345678.91}]);
createRoot(document.getElementById("root")!).render(<div className="min-w-0 max-w-full px-3 py-4"><SalesDashboardSummary report={report} inventory={inventory} selected={selected}/></div>);
