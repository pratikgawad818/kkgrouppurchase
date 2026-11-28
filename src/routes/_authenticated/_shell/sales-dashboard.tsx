import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { PageHeader, Loading } from "@/components/erp/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadCompleteRows } from "@/lib/complete-register";
import { fmtDate } from "@/lib/format";
import { SalesDashboardSummary, type DashboardView } from "@/components/erp/sales-dashboard-summary";
import { RefreshCw, Building2, Handshake, IndianRupee, Wallet } from "lucide-react";
import { summarizeFlatInventory, type FlatInventoryRow, salesToday, salesPeriodRange, validSalesRange, summarizeSalesPeriod, type SalesPeriod, type DateRange, type SalePeriodRow, type ExpensePeriodRow, type ReceiptPeriodRow } from "@/lib/sales-period-dashboard";
export const Route=createFileRoute("/_authenticated/_shell/sales-dashboard")({head:()=>({meta:[{title:"Sales Dashboard — KK GROUP ERP"}]}),component:()=> <SalesDashboard/>});
type Project={id:string;name:string};
const periods:[SalesPeriod,string][]=[["month","This month"],["3m","Last 3 months"],["6m","Last 6 months"],["1y","Last 1 year"],["custom","Custom dates"]];
export function SalesDashboard({initialView="overview"}:{initialView?:DashboardView}){
 const me=useMe(),actor=me.data?.profile.id,company=me.data?.profile.company_id;
 const [view,setView]=useState<DashboardView>(initialView);
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
 const outstanding=useQuery({queryKey:["sales-dashboard-outstanding",actor,company,ids],enabled:allowed&&scope.isSuccess&&projectValid,staleTime:0,queryFn:async()=>{
  const amounts=await Promise.all(ids.map(async id=>{const r=await supabase.rpc("sales_overview",{_project:id,_building:null});if(r.error)throw r.error;const n=Number((r.data as {outstanding?:number|string}|null)?.outstanding);if(!Number.isFinite(n)||n<0||!Number.isSafeInteger(Math.round(n*100)))throw Error("Invalid outstanding balance");return Math.round(n*100);}));
  const total=amounts.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(total))throw Error("Outstanding exceeds safe precision");return total;
 }});
 const ready=allowed&&scope.isSuccess&&valid&&projectValid&&report.isSuccess&&inventory.isSuccess&&outstanding.isSuccess&&!outstanding.isFetching&&!scope.isFetching&&!report.isFetching&&!inventory.isFetching;
 return <div className="min-w-0 max-w-full space-y-4 pb-6 sm:space-y-5">
  <PageHeader title={view==="trends"?"Sales & expense trends":view==="projects"?"Projects performance":me.data?.roles.includes("ceo")?"CEO Dashboard":"Senior Sales Dashboard"} subtitle={scope.isSuccess?`${projects.length} assigned project${projects.length===1?"":"s"}`:"Assigned project sales, collections and expenses."} actions={<Button size="sm" variant="outline" className="gap-2" aria-label="Refresh dashboard" onClick={()=>{void scope.refetch();if(scope.isSuccess&&projectValid){void report.refetch();void inventory.refetch();void outstanding.refetch();}}} disabled={!allowed||scope.isFetching||report.isFetching||inventory.isFetching||outstanding.isFetching||!valid||!projectValid}><RefreshCw className="h-4 w-4"/>Refresh</Button>}/>
  <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Dashboard sections">{([["overview","Overview"],["trends","Trends"],["projects","Projects"]] as const).map(([key,label])=><button key={key} type="button" aria-pressed={view===key} onClick={()=>setView(key)} className={"min-h-10 rounded-lg px-1 text-xs font-semibold sm:text-sm "+(view===key?"bg-[#163b76] text-white shadow-sm":"text-muted-foreground")}>{label}</button>)}</div>
  <section className="min-w-0 rounded-2xl border bg-card p-3 sm:p-4 space-y-3">
   <div className="grid min-w-0 gap-3 sm:grid-cols-2">
    <label className="min-w-0 text-xs font-medium">Project<select className="mt-1 h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base sm:text-sm" value={project} onChange={e=>setProject(e.target.value)}><option value="">All assigned projects</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="min-w-0 text-xs font-medium sm:hidden">Reporting period<select aria-label="Reporting period" className="mt-1 h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base" value={period} onChange={e=>{if(e.target.value==="custom")setCustom(range);setPeriod(e.target.value as SalesPeriod);}}>{periods.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <div className="hidden min-w-0 flex-wrap items-end gap-1 sm:flex" role="group" aria-label="Reporting period">{periods.map(([key,label])=><Button key={key} variant={period===key?"default":"outline"} size="sm" aria-pressed={period===key} onClick={()=>{if(key==="custom")setCustom(range);setPeriod(key);}}>{label}</Button>)}</div>
   </div>
   {period==="custom"&&<div className="grid min-w-0 gap-3 min-[400px]:grid-cols-2"><label className="min-w-0 text-xs font-medium">From date<Input aria-label="From date" className="mt-1 min-w-0" type="date" value={range.from} max={today} onChange={e=>setCustom({...range,from:e.target.value})}/></label><label className="min-w-0 text-xs font-medium">To date<Input aria-label="To date" className="mt-1 min-w-0" type="date" value={range.to} max={today} onChange={e=>setCustom({...range,to:e.target.value})}/></label></div>}
   {valid?<p className="text-xs tabular-nums text-muted-foreground">{fmtDate(range.from)} – {fmtDate(range.to)} · IST</p>:<p role="alert" className="text-xs text-destructive">Choose valid dates in order, not later than today.</p>}
   {!projectValid&&<p role="alert" className="text-sm text-destructive">This project is no longer assigned. Select another project.</p>}
  </section>
  {!allowed?<p role="alert">Sales and expense access is required.</p>:scope.error||report.error||inventory.error||outstanding.error?<p role="alert" className="rounded-xl border p-4 text-destructive">Could not load a complete report. Refresh to retry. No partial totals are shown.</p>:!valid||!projectValid?null:scope.isSuccess&&!projects.length?<section className="rounded-2xl border bg-card p-5 text-center"><Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground"/><h2 className="font-semibold">No assigned projects</h2><p className="mt-2 text-sm text-muted-foreground">Your administrator needs to assign a project before sales, inventory and expenses appear here.</p></section>:!ready?<Loading/>:<>
   <SalesDashboardSummary report={report.data!} inventory={inventory.data!} selected={selected} outstanding={outstanding.data!} view={view} onView={setView} onProject={id=>{setProject(id);setView("overview");window.scrollTo({top:0,behavior:"smooth"});}} quickActions={<section className="space-y-2"><h2 className="text-sm font-semibold">Quick actions</h2><div className="grid grid-cols-4 gap-1.5">{[{to:"/sales",search:{tab:"inventory"},label:"New booking",Icon:Handshake,tone:"bg-blue-50 text-blue-700"},{to:"/sales",search:{tab:"bookings"},label:"Add collection",Icon:IndianRupee,tone:"bg-amber-50 text-amber-700"},{to:"/finance/small-expenses",search:{action:"new"},label:"Add expense",Icon:Wallet,tone:"bg-rose-50 text-rose-700"},{to:"/units",search:{},label:"View flats",Icon:Building2,tone:"bg-sky-50 text-sky-700"}].map(({to,search,label,Icon,tone})=><Link key={label} to={to} search={search} className="flex min-w-0 flex-col items-center gap-1 rounded-xl border bg-card p-2 text-center text-[10px] font-medium leading-tight sm:text-xs"><span className={"grid size-10 place-items-center rounded-lg "+tone}><Icon className="size-5"/></span>{label}</Link>)}</div></section>}/>

  </>}
 </div>;
}
