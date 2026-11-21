import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/sales-spreadsheet";

type ReportRow={
 project_id:string;project_name:string;building_id:string;building_name:string;
 flats:number;available:number;active_bookings:number;contracted_value:number;
 verified_collections:number;buyer_outstanding:number;refund_pending:number;
};
const cash=(x:unknown)=>new Intl.NumberFormat("en-IN",{
 style:"currency",currency:"INR",maximumFractionDigits:0,
}).format(Number(x)||0);

export function SalesProjectReports({project,building}:{project:string;building:string}){
 const query=useQuery({
  queryKey:["sales-project-commercial-report",project],
  queryFn:async()=>{
   // PostgreSQL performs project/tenant checks on every row.
   const result=await supabase.rpc("sales_project_report" as never,{_project:project||null} as never);
   if(result.error)throw result.error;
   return (result.data??[]) as ReportRow[];
  },
 });
 const rows=(query.data??[]).filter(r=>!building||r.building_id===building);
 const totals=rows.reduce((a,r)=>({
  flats:a.flats+Number(r.flats),available:a.available+Number(r.available),
  bookings:a.bookings+Number(r.active_bookings),
  contract:a.contract+Number(r.contracted_value),
  paid:a.paid+Number(r.verified_collections),
  due:a.due+Number(r.buyer_outstanding),
  refunds:a.refunds+Number(r.refund_pending),
 }),{flats:0,available:0,bookings:0,contract:0,paid:0,due:0,refunds:0});
 const download=()=>downloadCsv("kk-sales-project-report.csv",[
  ["Project","Building","Total flats","Available","Active bookings","Contracted value (INR)",
   "Verified collections (INR)","Outstanding (INR)","Refund liabilities (INR)"],
  ...rows.map(r=>[r.project_name,r.building_name,r.flats,r.available,r.active_bookings,
   r.contracted_value,r.verified_collections,r.buyer_outstanding,r.refund_pending]),
 ]);
 return <section className="space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <div><h2 className="text-base font-semibold">Project-wise Sales Performance</h2>
    <p className="text-xs text-muted-foreground">Verified receipts only. Cancelled transactions are excluded from contracted sales but remaining refunds stay visible.</p></div>
   <div className="flex gap-2">
    <Button size="sm" variant="outline" onClick={()=>void query.refetch()}>Refresh</Button>
    <Button size="sm" disabled={!rows.length} onClick={download}>Export CSV for Excel</Button>
   </div>
  </div>
  {query.isLoading&&<p className="text-sm text-muted-foreground">Loading scoped reports…</p>}
  {query.isError&&<p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive" role="alert">
   Report unavailable: {query.error.message}</p>}
  {query.isSuccess&&<>
   <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
    {([
      ["Total flats",String(totals.flats)],["Available",String(totals.available)],
      ["Active bookings",String(totals.bookings)],["Contracted value",cash(totals.contract)],
      ["Verified collected",cash(totals.paid)],["Buyer outstanding",cash(totals.due)],
      ["Refund pending",cash(totals.refunds)],["Buildings",String(rows.length)],
    ] as const).map(([title,value])=><div key={title} className="rounded-lg border bg-card p-3">
     <p className="text-lg font-bold tabular-nums">{value}</p>
     <p className="text-xs text-muted-foreground">{title}</p>
    </div>)}
   </div>
   <div className="overflow-x-auto rounded-xl border bg-card">
    <table className="w-full min-w-[1050px] text-left text-sm">
     <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>
      {["Project","Building","Total","Available","Bookings","Contracted","Collected","Outstanding","Refunds due"].map(x=>
       <th key={x} className="px-3 py-3 font-medium">{x}</th>)}
     </tr></thead>
     <tbody className="divide-y">{rows.map(r=><tr key={r.building_id}>
      <td className="px-3 py-3">{r.project_name}</td>
      <td className="px-3 py-3 font-medium">{r.building_name}</td>
      <td className="px-3 py-3 tabular-nums">{r.flats}</td>
      <td className="px-3 py-3 tabular-nums">{r.available}</td>
      <td className="px-3 py-3 tabular-nums">{r.active_bookings}</td>
      <td className="px-3 py-3 tabular-nums">{cash(r.contracted_value)}</td>
      <td className="px-3 py-3 tabular-nums">{cash(r.verified_collections)}</td>
      <td className="px-3 py-3 tabular-nums">{cash(r.buyer_outstanding)}</td>
      <td className="px-3 py-3 tabular-nums">{cash(r.refund_pending)}</td>
     </tr>)}</tbody>
    </table>
    {!rows.length&&<p className="p-6 text-sm text-muted-foreground">No building matches this project filter.</p>}
   </div>
  </>}
 </section>;
}
