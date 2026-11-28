import { Building2, House, ChartNoAxesColumnIncreasing, CalendarCheck, Clock3 } from "lucide-react";
import { inr } from "@/lib/format";
import type { PeriodTotals, InventoryTotals } from "@/lib/sales-period-dashboard";
import { SalesDashboardCharts } from "./sales-dashboard-charts";
type Project={id:string;name:string};
const money=(c:number)=>inr(c/100);
function Metric({label,value,detail,kind="default"}:{label:string;value:string|number;detail?:string;kind?:"default"|"primary"}){
 return <div className={"min-w-0 rounded-xl p-3 sm:p-4 "+(kind==="primary"?"border border-primary/25 bg-primary/5":"border bg-card")}>
  <p className="text-xs leading-snug text-muted-foreground">{label}</p>
  <p className="mt-1.5 break-words text-[clamp(0.875rem,4.3vw,1.5rem)] font-semibold leading-tight tabular-nums [overflow-wrap:anywhere]">{value}</p>
  {detail&&<p className="mt-1 text-[11px] leading-snug text-muted-foreground">{detail}</p>}
 </div>;
}
export function SalesDashboardSummary({report,inventory,selected}:{report:{total:PeriodTotals;projects:Map<string,PeriodTotals>;months:Map<string,PeriodTotals>;categories:Map<string,number>};inventory:{total:InventoryTotals;projects:Map<string,InventoryTotals>};selected:Project[]}){
 const t=report.total,i=inventory.total;
 return <div data-sales-dashboard-summary className="min-w-0 space-y-4 sm:space-y-6">
  <section className="min-w-0 rounded-2xl border bg-card p-3 sm:p-5">
   <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-semibold sm:text-base"><Building2 className="h-4 w-4 text-primary"/>Flat inventory</h2><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">Current</span></div>
   <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
    <Metric label="Unsold flats" value={i.unsold} kind="primary" detail={i.available+" available · "+i.hold+" on hold"}/>
    <Metric label="Total flats" value={i.total} detail="Active inventory"/>
    <Metric label="Registered / possession" value={i.sold}/>
    <Metric label="Bookings in progress" value={i.inProgress}/>
   </div>
   {i.cancelled>0&&<p className="mt-2 text-xs text-muted-foreground">{i.cancelled} in cancelled status</p>}
   <p className="mt-2 text-[11px] text-muted-foreground">Live inventory, not affected by reporting dates.</p>
  </section>
  <section className="min-w-0 space-y-3">
   <h2 className="flex items-center gap-2 text-sm font-semibold sm:text-base"><ChartNoAxesColumnIncreasing className="h-4 w-4 text-primary"/>Performance in selected period</h2>
   <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
    <Metric label="Agreed sales value" value={money(t.bookedValue)} kind="primary" detail={t.bookings+" active bookings"}/>
    <Metric label="Verified collections" value={money(t.verified)} detail="Gross before refunds"/>
    <Metric label="Pending verification" value={money(t.pending)}/>
    <Metric label="Small expenses" value={money(t.expenses)} detail={t.expenseCount+" expense entries"}/>
   </div>
   <div className="grid grid-cols-3 gap-2 rounded-xl border bg-card p-3 text-center">
    <div className="min-w-0"><CalendarCheck className="mx-auto mb-1 h-4 w-4 text-muted-foreground"/><p className="font-semibold tabular-nums">{t.bookings}</p><p className="text-[11px] leading-tight text-muted-foreground">Bookings</p></div>
    <div className="min-w-0 border-x px-1"><House className="mx-auto mb-1 h-4 w-4 text-muted-foreground"/><p className="font-semibold tabular-nums">{t.registered}</p><p className="text-[11px] leading-tight text-muted-foreground">Registered</p></div>
    <div className="min-w-0"><Clock3 className="mx-auto mb-1 h-4 w-4 text-muted-foreground"/><p className="font-semibold tabular-nums">{t.cancelled}</p><p className="text-[11px] leading-tight text-muted-foreground">Cancelled</p></div>
   </div>
  </section>
  <SalesDashboardCharts months={report.months} categories={report.categories} inventory={i}/>
  <section className="min-w-0 space-y-3">
   <h2 className="font-semibold">Project-wise performance</h2>
   <div data-mobile-project-cards className="grid min-w-0 gap-3 md:hidden">{selected.map(p=>{const v=report.projects.get(p.id)!;const stock=inventory.projects.get(p.id)!;return <article key={p.id} className="min-w-0 rounded-xl border bg-card p-3">
    <div className="flex items-start justify-between gap-2"><h3 className="min-w-0 break-words font-semibold">{p.name}</h3><span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs">{stock.unsold} unsold</span></div>
    <dl className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-xs">{[["Bookings",v.bookings],["Registered / possession",stock.sold],["Agreed value",money(v.bookedValue)],["Verified receipts",money(v.verified)],["Pending receipts",money(v.pending)],["Small expenses",money(v.expenses)]].map(([label,value])=><div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
   </article>;})}</div>
   <div className="hidden min-w-0 overflow-x-auto rounded-xl border bg-card md:block"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-muted-foreground"><tr>{["Project","Unsold (current)","Bookings","Agreed value","Verified receipts","Pending receipts","Small expenses"].map(x=><th key={x} className="px-3 py-2 font-medium">{x}</th>)}</tr></thead><tbody>{selected.map(p=>{const v=report.projects.get(p.id)!;return <tr key={p.id} className="border-t"><td className="px-3 py-3 font-medium">{p.name}</td><td className="px-3">{inventory.projects.get(p.id)!.unsold}</td><td className="px-3">{v.bookings}</td><td className="px-3 tabular-nums">{money(v.bookedValue)}</td><td className="px-3 tabular-nums">{money(v.verified)}</td><td className="px-3 tabular-nums">{money(v.pending)}</td><td className="px-3 tabular-nums">{money(v.expenses)}</td></tr>;})}</tbody></table></div>
   <details className="rounded-lg border bg-card p-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">How totals are calculated</summary><p className="mt-2 leading-relaxed">Bookings use booking date and current status. Collections use payment date; verified amounts are gross before refunds. Expenses use spent date and recorded small expenses only. Unsold means available plus on hold. These measures are not profit or total project cost.</p></details>
  </section>
 </div>;
}
