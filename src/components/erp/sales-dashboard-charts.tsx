import { inr } from "@/lib/format";
import type { PeriodTotals, InventoryTotals } from "@/lib/sales-period-dashboard";
const colors=["#087f8c","#d97706","#2563eb","#7c3aed","#dc2626","#64748b","#16a34a","#be185d"];
const currency=(n:number)=>inr(n/100);
function Donut({title,items,format}:{title:string;items:{label:string;value:number}[];format:(n:number)=>string}){
 const total=items.reduce((n,x)=>n+x.value,0);
 let pos=0;
 const segments=items.map((x,i)=>{const start=pos;pos+=total?x.value/total*100:0;return {...x,color:colors[i%colors.length]!,start,end:pos};});
 const gradient=segments.filter(x=>x.value>0).map(x=>x.color+" "+x.start+"% "+x.end+"%").join(",");
 return <section className="min-w-0 rounded-xl border bg-card p-4 space-y-3">
  <h2 className="font-semibold">{title}</h2>
  {total===0?<p className="py-8 text-center text-sm text-muted-foreground">No data to chart.</p>:<div className="mx-auto relative h-36 w-36 rounded-full" style={{background:"conic-gradient("+gradient+")"}} aria-hidden="true"><div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-card text-center"><span className="text-xs text-muted-foreground">Total</span><strong className="max-w-full break-all px-1 text-xs tabular-nums">{format(total)}</strong></div></div>}
  <ul className="space-y-2 text-sm">{segments.map(x=><li key={x.label} className="flex items-start gap-2"><span aria-hidden="true" className="mt-1.5 h-3 w-3 shrink-0 rounded-sm" style={{background:x.color}}/><span className="min-w-0 flex-1 break-words">{x.label}</span><span className="text-right tabular-nums">{format(x.value)}<span className="block text-xs text-muted-foreground">{total?(x.value/total*100).toFixed(1):"0.0"}%</span></span></li>)}</ul>
 </section>;
}
function Trend({title,months,series}:{title:string;months:Map<string,PeriodTotals>;series:{key:"bookedValue"|"verified"|"expenses";label:string;color:string}[]}){
 const max=Math.max(1,...Array.from(months.values()).flatMap(x=>series.map(s=>x[s.key])));
 return <section className="min-w-0 rounded-xl border bg-card p-4 space-y-3"><h2 className="font-semibold">{title}</h2>
 <div className="flex flex-wrap gap-3 text-xs">{series.map(s=><span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{background:s.color}}/>{s.label}</span>)}</div>
 <p className="text-xs text-muted-foreground">Monthly amounts in ₹ · Scale maximum {currency(max)}</p>
 <div className="overflow-x-auto"><div className="flex items-end gap-3" style={{minWidth:Math.max(0,months.size*82)}}>{Array.from(months.entries()).map(([month,v])=><div key={month} className="flex flex-1 min-w-16 flex-col items-center gap-2"><div className="flex h-36 w-full items-end justify-center gap-1 border-b">{series.map(s=><div key={s.key} title={s.label+": "+currency(v[s.key])} className="w-5 rounded-t-sm" style={{background:s.color,height:v[s.key]/max*100+"%"}}/>)}</div><span className="text-xs text-muted-foreground">{month.slice(5)}/{month.slice(0,4)}</span></div>)}</div></div>
 <details className="text-xs"><summary className="cursor-pointer text-primary">View exact monthly figures</summary><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="py-2">Month</th>{series.map(s=><th key={s.key} className="p-2">{s.label}</th>)}</tr></thead><tbody>{Array.from(months.entries()).map(([m,v])=><tr key={m} className="border-t"><td className="py-2">{m}</td>{series.map(s=><td key={s.key} className="p-2 tabular-nums">{currency(v[s.key])}</td>)}</tr>)}</tbody></table></div></details>
 </section>;
}
export function SalesDashboardCharts({months,categories,inventory}:{months:Map<string,PeriodTotals>;categories:Map<string,number>;inventory:InventoryTotals}){
 const ranked=Array.from(categories.entries()).sort((a,b)=>b[1]-a[1]);
 const categoryItems=ranked.slice(0,7).map(([label,value])=>({label,value}));
 if(ranked.length>7)categoryItems.push({label:"Other categories",value:ranked.slice(7).reduce((n,x)=>n+x[1],0)});
 return <div className="grid gap-4 lg:grid-cols-2">
 <Trend title="Monthly sales and collections" months={months} series={[{key:"bookedValue",label:"Agreed booking value",color:colors[0]!},{key:"verified",label:"Verified collections",color:colors[2]!}]}/>
 <Trend title="Monthly small expenses" months={months} series={[{key:"expenses",label:"Recorded expenses",color:colors[1]!}]}/>
 <Donut title="Current flat inventory" items={[{label:"Available",value:inventory.available},{label:"On hold",value:inventory.hold},{label:"Bookings in progress",value:inventory.inProgress},{label:"Registered / possession",value:inventory.sold},{label:"Cancelled status",value:inventory.cancelled}]} format={String}/>
 <Donut title="Expenses by category" items={categoryItems} format={currency}/>
 </div>;
}
