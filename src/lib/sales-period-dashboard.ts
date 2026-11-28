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
export type ExpensePeriodRow={id:string;project_id:string;spent_on:string;status:string;amount:number|string};
export type ReceiptPeriodRow={id:string;project_id:string;paid_on:string;status:string;amount:number|string};
export type PeriodTotals={bookings:number;bookedValue:number;registered:number;cancelled:number;verified:number;pending:number;expenseCount:number;expenses:number};
const blank=():PeriodTotals=>({bookings:0,bookedValue:0,registered:0,cancelled:0,verified:0,pending:0,expenseCount:0,expenses:0});
function cents(value:number|string){const n=Number(value);const p=Math.round(n*100);if(!Number.isFinite(n)||n<0||!Number.isSafeInteger(p))throw Error("Invalid amount in dashboard");return p;}
function sum(a:number,b:number){const n=a+b;if(!Number.isSafeInteger(n))throw Error("Dashboard total exceeds safe precision");return n;}
export function summarizeSalesPeriod(projectIds:readonly string[],range:DateRange,sales:readonly SalePeriodRow[],expenses:readonly ExpensePeriodRow[],receipts:readonly ReceiptPeriodRow[]){
 const total=blank(),projects=new Map(projectIds.map(id=>[id,blank()]));
 function apply(row:{project_id:string},date:string,fn:(t:PeriodTotals)=>void){if(date<range.from||date>range.to)return;const p=projects.get(row.project_id);if(!p)throw Error("Report returned a project outside the selected scope");fn(p);fn(total);}
 for(const s of sales)apply(s,s.booked_on,t=>{if(s.status==="cancelled"){t.cancelled++;return;}if(!["booked","agreement_pending","agreement_done","registered","possession_pending","possession_completed"].includes(s.status))throw Error("Unknown sale status");t.bookings++;t.bookedValue=sum(t.bookedValue,cents(s.final_sale_price));if(["registered","possession_pending","possession_completed"].includes(s.status))t.registered++;});
 for(const e of expenses)if(e.status==="recorded")apply(e,e.spent_on,t=>{t.expenseCount++;t.expenses=sum(t.expenses,cents(e.amount));});
 for(const r of receipts)if(r.status==="verified"||r.status==="reported")apply(r,r.paid_on,t=>{const key=r.status==="verified"?"verified":"pending";t[key]=sum(t[key],cents(r.amount));});
 return {total,projects};
}
