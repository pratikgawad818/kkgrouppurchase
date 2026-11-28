import { Building2, ChartNoAxesColumnIncreasing, Coins, Wallet, IndianRupee, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { inr, inrCompact } from "@/lib/format";
import type { PeriodTotals, InventoryTotals } from "@/lib/sales-period-dashboard";
import { SalesDashboardCharts, FlatInventoryDonut } from "./sales-dashboard-charts";
type Project={id:string;name:string};
export type DashboardView="overview"|"trends"|"projects";
const money=(c:number)=>inr(c/100);
const compact=(c:number)=>inrCompact(c/100);
const tones={green:"bg-emerald-50 text-emerald-900 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-900",blue:"bg-blue-50 text-blue-900 border-blue-100 dark:bg-blue-950/40 dark:text-blue-100 dark:border-blue-900",orange:"bg-orange-50 text-orange-900 border-orange-100 dark:bg-orange-950/40 dark:text-orange-100 dark:border-orange-900",violet:"bg-violet-50 text-violet-900 border-violet-100 dark:bg-violet-950/40 dark:text-violet-100 dark:border-violet-900"} as const;
function Metric({label,amount,detail,tone,icon:Icon}:{label:string;amount:number;detail:string;tone:keyof typeof tones;icon:typeof Coins}){
 return <div className={"min-w-0 rounded-xl border p-3 sm:p-4 "+tones[tone]} title={money(amount)}>
  <div className="flex items-center gap-1.5"><Icon className="size-4 shrink-0"/><p className="text-xs font-medium leading-snug">{label}</p></div>
  <p className="mt-1.5 text-[clamp(1.05rem,4.8vw,1.7rem)] font-bold leading-tight tabular-nums [overflow-wrap:anywhere]">{compact(amount)}</p>
  <p className="mt-1 text-[11px] leading-snug opacity-80">{detail}</p>
  <span className="sr-only">Exact amount: {money(amount)}</span>
 </div>;
}
export function SalesDashboardSummary({report,inventory,selected,outstanding=0,view="overview",quickActions,onView,onProject}:{report:{total:PeriodTotals;projects:Map<string,PeriodTotals>;months:Map<string,PeriodTotals>;categories:Map<string,number>};inventory:{total:InventoryTotals;projects:Map<string,InventoryTotals>};selected:Project[];outstanding?:number;view?:DashboardView;quickActions?:ReactNode;onView?:(view:DashboardView)=>void;onProject?:(id:string)=>void}){
 const t=report.total,i=inventory.total;
 return <div data-sales-dashboard-summary className="min-w-0 space-y-3 sm:space-y-6">
 {view==="overview"&&<>
  <section className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4" aria-label="Financial summary">
   <Metric label="Sales value" amount={t.bookedValue} tone="green" icon={ChartNoAxesColumnIncreasing} detail={t.bookings+" active bookings"}/>
   <Metric label="Collections" amount={t.verified} tone="blue" icon={Coins} detail="Verified in period"/>
   <Metric label="Expenses" amount={t.expenses} tone="orange" icon={Wallet} detail={t.expenseCount+" small expenses"}/>
   <Metric label="Outstanding" amount={outstanding} tone="violet" icon={IndianRupee} detail="Current balance due"/>
  </section>
  <FlatInventoryDonut inventory={i}/>
  <div className="grid grid-cols-3 gap-2 rounded-xl border bg-card p-3 text-center">
    <div className="min-w-0"><p className="font-bold tabular-nums">{t.bookings}</p><p className="text-[11px] text-muted-foreground">Bookings in period</p></div>
    <div className="min-w-0 border-x px-1"><p className="font-bold tabular-nums">{t.registered}</p><p className="text-[11px] text-muted-foreground">Registered</p></div>
    <div className="min-w-0"><p className="font-bold tabular-nums">{t.cancelled}</p><p className="text-[11px] text-muted-foreground">Cancelled</p></div>
  </div>
  <div className="rounded-xl border bg-card p-3 flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">Collections pending verification (period)</span><strong className="text-sm tabular-nums [overflow-wrap:anywhere]">{money(t.pending)}</strong></div>
  {quickActions}
  {onView&&<div className="grid grid-cols-2 gap-2"><button type="button" className="flex min-h-11 items-center justify-between rounded-xl border bg-card px-3 text-sm font-semibold" onClick={()=>onView("trends")}>Sales trends<ChevronRight className="size-4"/></button><button type="button" className="flex min-h-11 items-center justify-between rounded-xl border bg-card px-3 text-sm font-semibold" onClick={()=>onView("projects")}>Projects<ChevronRight className="size-4"/></button></div>}
 </>}
 {(view==="trends"||!onView)&&<SalesDashboardCharts months={report.months} categories={report.categories} inventory={i} includeInventory={false}/>}
 {(view==="projects"||!onView)&&<section className="min-w-0 space-y-3">
   <h2 className="font-semibold">Project-wise performance</h2>
   <div data-mobile-project-cards className="grid min-w-0 gap-3 md:hidden">{selected.map(p=>{const v=report.projects.get(p.id)!;const stock=inventory.projects.get(p.id)!;return <article key={p.id} className="min-w-0 rounded-2xl border bg-card p-3 shadow-sm">
    <div className="flex items-center gap-3"><div className="grid size-12 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200"><Building2 className="size-6"/></div><div className="min-w-0 flex-1"><h3 className="break-words font-semibold">{p.name}</h3><p className="text-xs text-muted-foreground">Total flats: {stock.total}{!!stock.thirdParty&&<span className="block text-red-700 dark:text-red-300">Landowner / investor: {stock.thirdParty}</span>}</p></div></div>
    <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">{[["Sold",stock.sold,"bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"],["Unsold",stock.unsold,"bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100"],["Booked",stock.inProgress,"bg-violet-50 text-violet-900 dark:bg-violet-950 dark:text-violet-100"]].map(([label,value,tone])=><div key={label} className={"min-w-0 rounded-lg p-2 "+tone}><p className="text-xs">{label}</p><p className="text-lg font-bold tabular-nums">{value}</p></div>)}</div>
    <dl className="mt-3 divide-y text-sm">{[["Sales value",money(v.bookedValue)],["Collections",money(v.verified)],["Expenses",money(v.expenses)],["Pending verification",money(v.pending)]].map(([label,value])=><div key={label} className="flex min-w-0 items-start justify-between gap-2 py-2"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 text-right font-semibold tabular-nums [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
    {onProject&&<button type="button" className="flex min-h-11 w-full items-center justify-between rounded-lg border px-3 text-sm font-medium text-primary" onClick={()=>onProject(p.id)}>View project dashboard<ChevronRight className="size-4"/></button>}
   </article>;})}</div>
   <div className="hidden min-w-0 overflow-x-auto rounded-xl border bg-card md:block"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-muted-foreground"><tr>{["Project","Unsold (current)","Bookings","Agreed value","Verified receipts","Pending receipts","Small expenses"].map(x=><th key={x} className="px-3 py-2 font-medium">{x}</th>)}</tr></thead><tbody>{selected.map(p=>{const v=report.projects.get(p.id)!;return <tr key={p.id} className="border-t"><td className="px-3 py-3 font-medium">{onProject?<button className="text-left text-primary" onClick={()=>onProject(p.id)}>{p.name}</button>:p.name}</td><td className="px-3">{inventory.projects.get(p.id)!.unsold}</td><td className="px-3">{v.bookings}</td><td className="px-3 tabular-nums">{money(v.bookedValue)}</td><td className="px-3 tabular-nums">{money(v.verified)}</td><td className="px-3 tabular-nums">{money(v.pending)}</td><td className="px-3 tabular-nums">{money(v.expenses)}</td></tr>;})}</tbody></table></div>
  </section>}
  <details className="rounded-lg border bg-card p-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">How totals are calculated</summary><p className="mt-2 leading-relaxed">Booking value uses booking date and current status. Collections are gross verified receipts by payment date; expenses are recorded small expenses by spent date. Outstanding and inventory are current snapshots, independent of period. Unsold means builder available plus on hold; excludes landowner and investor allocations. These are not profit or total project cost.</p></details>
 </div>;
}
