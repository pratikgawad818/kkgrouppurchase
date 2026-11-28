import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { PageHeader, Loading } from "@/components/erp/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadCompleteRows } from "@/lib/complete-register";
import { fmtDate, inr } from "@/lib/format";
import { SalesDashboardCharts } from "@/components/erp/sales-dashboard-charts";
import { summarizeFlatInventory, type FlatInventoryRow, salesToday, salesPeriodRange, validSalesRange, summarizeSalesPeriod, type SalesPeriod, type DateRange, type SalePeriodRow, type ExpensePeriodRow, type ReceiptPeriodRow } from "@/lib/sales-period-dashboard";
export const Route=createFileRoute("/_authenticated/_shell/sales-dashboard")({head:()=>({meta:[{title:"Sales Dashboard — KK GROUP ERP"}]}),component:SalesDashboard});
type Project={id:string;name:string};
const periods:[SalesPeriod,string][]=[["month","This month"],["3m","Last 3 months"],["6m","Last 6 months"],["1y","Last 1 year"],["custom","Custom dates"]];
const money=(c:number)=>inr(c/100);
function SalesDashboard(){
 const me=useMe(),actor=me.data?.profile.id,company=me.data?.profile.company_id;
 const [period,setPeriod]=useState<SalesPeriod>("month");
 const [custom,setCustom]=useState<DateRange>(()=>salesPeriodRange("month"));
 const [project,setProject]=useState("");
 const today=salesToday(),range=period==="custom"?custom:salesPeriodRange(period,today);
 const valid=validSalesRange(range,today);
 const allowed=!!actor&&!!company&&!!me.data?.profile.is_active&&!!me.data?.roles.some(r=>r==="ceo"||r==="senior_sales_executive")&&!!me.data?.permissions.has("sales.bookings")&&!!me.data?.permissions.has("small_expense.create");
 const scope=useQuery({queryKey:["sales-dashboard-projects",actor,company],enabled:allowed,staleTime:0,queryFn:async()=>{
  const assignments=await loadCompleteRows<{id:string}>(async(start,end)=>{
   const r=await supabase.from("user_project_assignments").select("project_id",{count:"exact"}).eq("user_id",actor!).order("project_id").range(start,end);
   return {data:r.data?.map(a=>({id:a.project_id}))??null,count:r.count,error:r.error};
  });
  const ids=assignments.map(a=>a.id);if(!ids.length)return [] as Project[];
  return loadCompleteRows<Project>(async(start,end)=>await supabase.from("projects").select("id,name",{count:"exact"}).eq("company_id",company!).in("id",ids).order("id").range(start,end));
 }});
 const projects=scope.data??[],selected=project?projects.filter(p=>p.id===project):projects;
 const ids=selected.map(p=>p.id),projectValid=!project||ids.length===1;
 const inventory=useQuery({queryKey:["sales-dashboard-inventory",actor,company,ids],enabled:allowed&&scope.isSuccess&&projectValid,staleTime:0,queryFn:async()=>{
  if(!ids.length)return summarizeFlatInventory([],[]);
  const rows=await loadCompleteRows<FlatInventoryRow>(async(start,end)=>await supabase.from("units").select("id,project_id,status",{count:"exact"}).in("project_id",ids).eq("record_status","active").order("id").range(start,end));
  return summarizeFlatInventory(ids,rows);
 }});
 const report=useQuery({queryKey:["sales-dashboard",actor,company,ids,range.from,range.to],enabled:allowed&&scope.isSuccess&&valid&&projectValid,staleTime:0,queryFn:async()=>{
  if(!ids.length)return summarizeSalesPeriod([],range,[],[],[]);
  const [sales,expenses,receipts]=await Promise.all([
   loadCompleteRows<SalePeriodRow>(async(start,end)=>await supabase.from("property_sales").select("id,project_id,booked_on,status,final_sale_price",{count:"exact"}).in("project_id",ids).gte("booked_on",range.from).lte("booked_on",range.to).order("id").range(start,end)),
   loadCompleteRows<ExpensePeriodRow>(async(start,end)=>{
    // site_small_expenses types may lag the existing live table.
    const db=supabase as any;
    return db.from("site_small_expenses").select("id,project_id,spent_on,status,amount,category",{count:"exact"}).eq("company_id",company!).in("project_id",ids).eq("status","recorded").gte("spent_on",range.from).lte("spent_on",range.to).order("id").range(start,end);
   }),
   loadCompleteRows<ReceiptPeriodRow>(async(start,end)=>{
    const r=await supabase.from("property_sale_receipts").select("id,paid_on,status,amount,property_sales!inner(project_id)",{count:"exact"}).in("property_sales.project_id",ids).in("status",["verified","reported"]).gte("paid_on",range.from).lte("paid_on",range.to).order("id").range(start,end);
    return {data:r.data?.map(x=>({id:x.id,paid_on:x.paid_on,status:x.status,amount:x.amount,project_id:x.property_sales?.project_id??""}))??null,count:r.count,error:r.error};
   }),
  ]);
  return summarizeSalesPeriod(ids,range,sales,expenses,receipts);
 }});
 const t=report.data?.total,ready=allowed&&scope.isSuccess&&valid&&projectValid&&report.isSuccess&&inventory.isSuccess&&!scope.isFetching&&!report.isFetching&&!inventory.isFetching;
 const metrics=t?[["Bookings (non-cancelled)",String(t.bookings)],["Agreed booking value",money(t.bookedValue)],["Currently registered / possession",String(t.registered)],["Verified collections",money(t.verified)],["Collections pending verification",money(t.pending)],["Recorded small expenses",money(t.expenses)],["Expense entries",String(t.expenseCount)],["Cancelled bookings",String(t.cancelled)]]:[];
 return <div className="space-y-5 pb-8 min-w-0">
  <PageHeader title={me.data?.roles.includes("ceo")?"CEO Dashboard":"Senior Sales Dashboard"} subtitle="Sales performance, customer collections and small expenses for your assigned projects." actions={<Button variant="outline" onClick={()=>{void scope.refetch();if(scope.isSuccess&&projectValid){void report.refetch();void inventory.refetch();}}} disabled={!allowed||scope.isFetching||report.isFetching||inventory.isFetching||!valid||!projectValid}>Refresh</Button>}/>
  <section className="rounded-xl border bg-card p-4 space-y-4">
   <div className="flex flex-wrap gap-2" role="group" aria-label="Reporting period">{periods.map(([key,label])=><Button key={key} variant={period===key?"default":"outline"} size="sm" aria-pressed={period===key} onClick={()=>setPeriod(key)}>{label}</Button>)}</div>
   <div className="grid gap-3 sm:grid-cols-3">
    <label className="text-sm">Project<select className="mt-1 h-10 w-full rounded-lg border bg-background px-3" value={project} onChange={e=>setProject(e.target.value)}><option value="">All assigned projects</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="text-sm">From date<Input className="mt-1" type="date" value={range.from} max={today} onChange={e=>{setCustom({...range,from:e.target.value});setPeriod("custom");}}/></label>
    <label className="text-sm">To date<Input className="mt-1" type="date" value={range.to} max={today} onChange={e=>{setCustom({...range,to:e.target.value});setPeriod("custom");}}/></label>
   </div>
   {valid?<p className="text-xs text-muted-foreground">Reporting period: {fmtDate(range.from)} – {fmtDate(range.to)} · Both dates included · India time</p>:<p role="alert" className="text-sm text-destructive">Choose valid dates in order, not later than today.</p>}
   {!projectValid&&<p role="alert" className="text-sm text-destructive">This project is no longer assigned. Select another project.</p>}
  </section>
  {!allowed?<p role="alert">Sales and expense access is required.</p>:scope.error||report.error||inventory.error?<p role="alert" className="rounded-xl border p-4 text-destructive">Could not load a complete report. Refresh to retry. No partial totals are shown.</p>:!valid||!projectValid?null:scope.isSuccess&&!projects.length?<p className="rounded-xl border p-4">No projects assigned to your account. Contact your administrator.</p>:!ready?<Loading/>:<>
   <section className="rounded-xl border bg-card p-4 space-y-3"><div><h2 className="font-semibold">Current flat inventory</h2><p className="text-xs text-muted-foreground">Live status across selected projects, independent of reporting dates. Unsold = available + on hold; bookings in progress are separate.</p></div><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Total flats",inventory.data!.total.total],["Unsold flats",inventory.data!.total.unsold],["Available to sell",inventory.data!.total.available],["On hold",inventory.data!.total.hold],["Bookings in progress",inventory.data!.total.inProgress],["Registered / possession",inventory.data!.total.sold],["Cancelled status",inventory.data!.total.cancelled]].map(([label,value])=><div key={label} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>)}</div></section>
   <section className="grid gap-3 grid-cols-2 lg:grid-cols-4">{metrics.map(([label,value])=><div key={label} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-lg font-bold tabular-nums break-words">{value}</p></div>)}</section>
   <SalesDashboardCharts months={report.data!.months} categories={report.data!.categories} inventory={inventory.data!.total}/>
   <section className="rounded-xl border bg-card p-4 space-y-3"><h2 className="font-semibold">Project-wise performance</h2>
    <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-muted-foreground"><tr>{["Project","Unsold (current)","Bookings","Agreed value","Verified receipts","Pending receipts","Small expenses"].map(x=><th key={x} className="px-3 py-2 font-medium">{x}</th>)}</tr></thead><tbody>{selected.map(p=>{const v=report.data!.projects.get(p.id)!;return <tr key={p.id} className="border-t"><td className="px-3 py-3 font-medium">{p.name}</td><td className="px-3">{v.bookings}</td><td className="px-3 tabular-nums">{money(v.bookedValue)}</td><td className="px-3 tabular-nums">{money(v.verified)}</td><td className="px-3 tabular-nums">{money(v.pending)}</td><td className="px-3 tabular-nums">{money(v.expenses)}</td></tr>;})}</tbody></table></div>
    <p className="text-xs text-muted-foreground">Bookings use booking date and current status, not legal registration date. Collections use payment date; verified amounts are gross receipts before refunds. Expenses use spent date and recorded small expenses only. These are separate indicators, not profit or total project cost.</p>
   </section>
   <div className="flex flex-wrap gap-2"><Button asChild><Link to="/sales">Sales & bookings</Link></Button><Button asChild variant="outline"><Link to="/finance/small-expenses">Project expenses</Link></Button></div>
  </>}
 </div>;
}
