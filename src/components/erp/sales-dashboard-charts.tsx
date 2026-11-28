import { useState } from "react";
import { inr, inrCompact } from "@/lib/format";
import type { PeriodTotals, InventoryTotals } from "@/lib/sales-period-dashboard";
const colors=["#2563eb","#f59e0b","#16a34a","#9333ea","#dc2626","#64748b","#0891b2","#be185d"];
const currency=(n:number)=>inr(n/100);
function Donut({title,items,format,inventory=false}:{title:string;items:{label:string;value:number}[];format:(n:number)=>string;inventory?:boolean}){
 const total=items.reduce((n,x)=>n+x.value,0);
 let pos=0;
 const segments=items.map((x,i)=>{const start=pos;pos+=total?x.value/total*100:0;return {...x,color:colors[i%colors.length]!,start,end:pos};});
 const gradient=segments.filter(x=>x.value>0).map(x=>x.color+" "+x.start+"% "+x.end+"%").join(",");
 return <section className="min-w-0 rounded-2xl border bg-card p-3 sm:p-5 space-y-3">
  <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold sm:text-base">{title}</h2>{inventory&&<span className="shrink-0 text-xs">Total flats: <b>{total}</b></span>}</div>
  <div className="grid min-w-0 grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-center gap-3 sm:gap-5">{total===0?<p className="py-8 text-center text-sm text-muted-foreground">No data to chart.</p>:<div className="relative mx-auto aspect-square w-full max-w-40 rounded-full" style={{background:"conic-gradient("+gradient+")"}} aria-hidden="true"><div className="absolute inset-[19%] flex flex-col items-center justify-center rounded-full bg-card text-center"><span className="text-[10px] text-muted-foreground">{inventory?"Flats":"Total"}</span><strong className="max-w-full px-1 text-center text-xs tabular-nums [overflow-wrap:anywhere]">{format(total)}</strong></div></div>}
  <ul className="min-w-0 space-y-2 text-xs">{segments.map(x=><li key={x.label} className="flex items-start gap-2"><span aria-hidden="true" className="mt-1.5 h-3 w-3 shrink-0 rounded-sm" style={{background:x.color}}/><span className="min-w-0 flex-1 break-words">{x.label}</span><span className="min-w-0 max-w-[56%] text-right font-medium tabular-nums [overflow-wrap:anywhere]">{format(x.value)}<span className="block text-xs text-muted-foreground">{total?(x.value/total*100).toFixed(1):"0.0"}%</span></span></li>)}</ul></div>{inventory&&<p className="text-[11px] text-muted-foreground">Current inventory · Unsold includes available and on hold.</p>}
 </section>;
}
function Trend({title,months,series}:{title:string;months:Map<string,PeriodTotals>;series:{key:"bookedValue"|"verified"|"expenses";label:string;color:string}[]}){
 const entries=Array.from(months.entries());
 const [monthChoice,setMonthChoice]=useState("");
 const selectedMonth=entries.find(([month])=>month===monthChoice)??entries[entries.length-1];
 const max=Math.max(1,...entries.flatMap(([,x])=>series.map(s=>x[s.key])));
 return <section className="min-w-0 rounded-xl border bg-card p-4 space-y-3"><h2 className="font-semibold">{title}</h2>
 <div className="flex flex-wrap gap-3 text-xs">{series.map(s=><span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{background:s.color}}/>{s.label}</span>)}</div>
 <p className="text-xs text-muted-foreground">Monthly amounts in ₹ · Scale maximum {inrCompact(max/100)}</p>
 <div className="hidden min-w-0 max-w-full overflow-x-auto sm:block"><div className="flex items-end gap-3" style={{minWidth:Math.max(0,months.size*82)}}>{Array.from(months.entries()).map(([month,v])=><div key={month} className="flex flex-1 min-w-16 flex-col items-center gap-2"><div className="flex h-36 w-full items-end justify-center gap-1 border-b">{series.map(s=><div key={s.key} title={s.label+": "+currency(v[s.key])} className="w-5 rounded-t-sm" style={{background:s.color,height:v[s.key]/max*100+"%"}}/>)}</div><span className="text-xs text-muted-foreground">{month.slice(5)}/{month.slice(0,4)}</span></div>)}</div></div>
 {selectedMonth&&<div data-mobile-trend className="min-w-0 space-y-3 sm:hidden">
 <label className="block text-xs font-medium">Month<select aria-label={title+" month"} className="mt-1 h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base" value={selectedMonth[0]} onChange={e=>setMonthChoice(e.target.value)}>{entries.map(([m])=><option key={m} value={m}>{m.slice(5)}/{m.slice(0,4)}</option>)}</select></label>
 {series.map(s=><div key={s.key} className="min-w-0 space-y-1.5"><div className="flex items-start justify-between gap-2 text-xs"><span className="min-w-0">{s.label}</span><strong className="min-w-0 max-w-[54%] text-right tabular-nums [overflow-wrap:anywhere]">{currency(selectedMonth[1][s.key])}</strong></div><div className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{background:s.color,width:selectedMonth[1][s.key]/max*100+"%"}}/></div></div>)}
 <div className="flex h-28 items-end gap-1 border-b" aria-label="All month trend overview">{entries.map(([m,v])=><button key={m} type="button" onClick={()=>setMonthChoice(m)} aria-label={"Show "+m} aria-pressed={selectedMonth[0]===m} className={"flex min-w-0 flex-1 items-end justify-center gap-px rounded-t-sm h-full "+(selectedMonth[0]===m?"bg-muted ring-1 ring-primary/40":"")} title={m}>{series.map(s=><span key={s.key} className="w-full max-w-3 rounded-t-sm" style={{background:s.color,height:v[s.key]/max*100+"%"}}/>)}</button>)}</div>
 <div className="flex justify-between text-[10px] text-muted-foreground"><span>{entries[0]?.[0]}</span><span>{entries[entries.length-1]?.[0]}</span></div>
 </div>}
 <details className="min-w-0 text-xs"><summary className="cursor-pointer text-primary">View exact monthly figures</summary><div className="mt-2 space-y-2 sm:hidden">{entries.map(([m,v])=><div key={m} className="rounded-lg border p-2"><p className="font-medium">{m}</p>{series.map(s=><div key={s.key} className="mt-1 flex justify-between gap-2"><span className="min-w-0">{s.label}</span><span className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{currency(v[s.key])}</span></div>)}</div>)}</div><div className="hidden min-w-0 overflow-x-auto sm:block"><table className="w-full text-left"><thead><tr><th className="py-2">Month</th>{series.map(s=><th key={s.key} className="p-2">{s.label}</th>)}</tr></thead><tbody>{Array.from(months.entries()).map(([m,v])=><tr key={m} className="border-t"><td className="py-2">{m}</td>{series.map(s=><td key={s.key} className="p-2 tabular-nums">{currency(v[s.key])}</td>)}</tr>)}</tbody></table></div></details>
 </section>;
}
export function FlatInventoryDonut({inventory}:{inventory:InventoryTotals}){return <Donut title="Flat inventory overview" inventory items={[{label:"Unsold flats",value:inventory.unsold},{label:"Booked",value:inventory.inProgress},{label:"Sold / registered",value:inventory.sold},...(inventory.cancelled?[{label:"Cancelled",value:inventory.cancelled}]:[])]} format={String}/>;}
export function SalesDashboardCharts({months,categories,inventory,includeInventory=true}:{months:Map<string,PeriodTotals>;categories:Map<string,number>;inventory:InventoryTotals;includeInventory?:boolean}){
 const ranked=Array.from(categories.entries()).sort((a,b)=>b[1]-a[1]);
 const categoryItems=ranked.slice(0,7).map(([label,value])=>({label,value}));
 if(ranked.length>7)categoryItems.push({label:"Other categories",value:ranked.slice(7).reduce((n,x)=>n+x[1],0)});
 return <div className="grid min-w-0 grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
 <Trend title="Monthly sales and collections" months={months} series={[{key:"bookedValue",label:"Agreed booking value",color:colors[0]!},{key:"verified",label:"Verified collections",color:colors[2]!}]}/>
 <Trend title="Monthly small expenses" months={months} series={[{key:"expenses",label:"Recorded expenses",color:colors[3]!}]}/>
 {includeInventory&&<FlatInventoryDonut inventory={inventory}/> }
 <Donut title="Expenses by category" items={categoryItems} format={currency}/>
 </div>;
}
