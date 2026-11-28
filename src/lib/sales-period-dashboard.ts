import { isoDateToDisplay } from "./date-format.ts";
export type SalesPeriod = "month"|"3m"|"6m"|"1y"|"custom";
export type DateRange = {from:string;to:string};
export const salesToday = (now = new Date()) => new Date(now.getTime()+330*60000).toISOString().slice(0,10);
export function validSalesRange(range:DateRange,today=salesToday()){
 return !!isoDateToDisplay(range.from)&&!!isoDateToDisplay(range.to)&&range.from<=range.to&&range.to<=today;
}
export function salesPeriodRange(period:Exclude<SalesPeriod,"custom">,today=salesToday()):DateRange{
 if(!isoDateToDisplay(today))throw new Error("Invalid reporting date");
 if(period==="month")return {from:today.slice(0,7)+"-01",to:today};
 const [y,m,d]=today.split("-").map(Number);
 const months=period==="3m"?3:period==="6m"?6:12;
 const first=new Date(Date.UTC(y!,m!-1-months,1));
 const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 first.setUTCDate(Math.min(d!,last));
 // Inclusive trailing period: the day after the matching prior date through today.
 first.setUTCDate(first.getUTCDate()+1);
 return {from:first.toISOString().slice(0,10),to:today};
}
export type SalePeriodRow={id:string;project_id:string;booked_on:string;status:string;final_sale_price:number|string};
export type ExpensePeriodRow={id:string;project_id:string;spent_on:string;status:string;amount:number|string;category?:string|null};
export type ReceiptPeriodRow={id:string;project_id:string;paid_on:string;status:string;amount:number|string};
export type PeriodTotals={bookings:number;bookedValue:number;registered:number;cancelled:number;verified:number;pending:number;expenseCount:number;expenses:number};
const blank=():PeriodTotals=>({bookings:0,bookedValue:0,registered:0,cancelled:0,verified:0,pending:0,expenseCount:0,expenses:0});
function cents(value:number|string){const n=Number(value);const p=Math.round(n*100);if(!Number.isFinite(n)||n<0||!Number.isSafeInteger(p))throw Error("Invalid amount in dashboard");return p;}
function sum(a:number,b:number){const n=a+b;if(!Number.isSafeInteger(n))throw Error("Dashboard total exceeds safe precision");return n;}
export function summarizeSalesPeriod(projectIds:readonly string[],range:DateRange,sales:readonly SalePeriodRow[],expenses:readonly ExpensePeriodRow[],receipts:readonly ReceiptPeriodRow[]){
 const total=blank(),projects=new Map(projectIds.map(id=>[id,blank()]));
 const months=new Map<string,PeriodTotals>();
 const categories=new Map<string,number>();
 for(let month=range.from.slice(0,7);month<=range.to.slice(0,7);){months.set(month,blank());const [y,m]=month.split("-").map(Number);month=m===12?String(y!+1).padStart(4,"0")+"-01":String(y).padStart(4,"0")+"-"+String(m!+1).padStart(2,"0");}
 function apply(row:{project_id:string},date:string,fn:(t:PeriodTotals)=>void){if(date<range.from||date>range.to)return;const p=projects.get(row.project_id);if(!p)throw Error("Report returned a project outside the selected scope");fn(p);fn(total);fn(months.get(date.slice(0,7))!);}
 for(const s of sales)apply(s,s.booked_on,t=>{if(s.status==="cancelled"){t.cancelled++;return;}if(!["booked","agreement_pending","agreement_done","registered","possession_pending","possession_completed"].includes(s.status))throw Error("Unknown sale status");t.bookings++;t.bookedValue=sum(t.bookedValue,cents(s.final_sale_price));if(["registered","possession_pending","possession_completed"].includes(s.status))t.registered++;});
 for(const e of expenses)if(e.status==="recorded")apply(e,e.spent_on,t=>{t.expenseCount++;t.expenses=sum(t.expenses,cents(e.amount));});
 for(const e of expenses)if(e.status==="recorded"&&e.spent_on>=range.from&&e.spent_on<=range.to){const key=e.category?.trim()||"Uncategorized";categories.set(key,sum(categories.get(key)??0,cents(e.amount)));}
 for(const r of receipts)if(r.status==="verified"||r.status==="reported")apply(r,r.paid_on,t=>{const key=r.status==="verified"?"verified":"pending";t[key]=sum(t[key],cents(r.amount));});
 return {total,projects,months,categories};
}

export type FlatInventoryRow={id:string;project_id:string;status:string;ownership_type?:string;legacy_sale_status?:string|null};
export type InventoryTotals={available:number;hold:number;inProgress:number;sold:number;cancelled:number;total:number;unsold:number;thirdParty?:number};
const inventoryBlank=():InventoryTotals=>({available:0,hold:0,inProgress:0,sold:0,cancelled:0,total:0,unsold:0});
export function summarizeFlatInventory(ids:readonly string[],rows:readonly FlatInventoryRow[]){
 const total=inventoryBlank(),projects=new Map(ids.map(id=>[id,inventoryBlank()]));
 for(const row of rows){
  const p=projects.get(row.project_id);if(!p)throw Error("Inventory returned an unassigned project");
  const key=row.ownership_type&&row.ownership_type!=="builder"?"thirdParty":row.legacy_sale_status==="sold"?"sold":row.legacy_sale_status==="booked"?"inProgress":row.status==="available"?"available":row.status==="hold"?"hold":row.status==="cancelled"?"cancelled":["booked","agreement_pending","agreement_done"].includes(row.status)?"inProgress":["registered","possession_pending","possession_completed"].includes(row.status)?"sold":null;
  if(!key)throw Error("Unknown flat status");
  for(const t of [p,total]){if(key==="thirdParty")t.thirdParty=(t.thirdParty??0)+1;else t[key]++;t.total++;if(key==="available"||key==="hold")t.unsold++;}
 }
 return {total,projects};
}
