import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search, Boxes, PackageCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Loading, PageHeader, Stat } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, inr, num } from "@/lib/format";
import { PAGE } from "@/lib/fy";
import { selectCls } from "@/lib/po";
import { loadCompleteRows } from "@/lib/complete-register";
import { summarizeSelectedMaterial } from "@/lib/material-usage-tracker";

export const Route = createFileRoute("/_authenticated/_shell/inventory/material-consumption")({
  head: () => ({ meta: [{ title: "Project Material Consumption — KK GROUP ERP" }] }),
  component: MaterialConsumption,
});

function MaterialConsumption() {
  const [projectId, setProjectId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const q = useQuery({
    queryKey: ["project-material-consumption", projectId],
    queryFn: async () => {
      return loadCompleteRows(async (start,end)=>{
        const {data,count,error} = await supabase.rpc("project_material_consumption", {
          _project_id: (projectId || null) as unknown as string,
        },{count:"exact"}).order("project_id").order("building_id").order("material_id").range(start,end);
        return {data: data?.map(row=>({...row,id:[row.project_id,row.building_id??"general",row.material_id].join("|")}))??null,count,error};
      },{maxRows:10000});
    },
  });
  const projectOptions = useQuery({
    queryKey: ["material-consumption-project-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id,name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const physicalStock = useQuery({
    queryKey:["material-stock-balance",materialId],enabled:!!materialId,staleTime:30_000,
    queryFn:()=>loadCompleteRows(async(start,end)=>{
      const {data,count,error}=await supabase.from("warehouse_stock")
        .select("warehouse_id,quantity_on_hand,warehouses(name)",{count:"exact"})
        .eq("material_id",materialId).order("warehouse_id").range(start,end);
      return {data:data?.map(row=>({...row,id:row.warehouse_id}))??null,count,error};
    },{maxRows:10000}),
  });
  const all = q.data ?? [];
  const projects = projectOptions.data ?? [...new Map(all.map(x=>[x.project_id,{id:x.project_id,name:x.project_name}])).values()];
  const buildings = [...new Map(all.filter(x=>x.building_id&&(!projectId||x.project_id===projectId))
    .map(x=>[x.building_id!,{id:x.building_id!,name:x.building_name??"Building"}])).values()];
  const materials = [...new Map(all.map(x=>[x.material_id,
    {id:x.material_id,name:x.material_name,code:x.material_code,unit:x.unit_code}])).values()]
    .sort((a,b)=>a.name.localeCompare(b.name));
  const rows = all.filter(x =>
    (!buildingId || (buildingId==="general"?!x.building_id:x.building_id===buildingId)) &&
    (!materialId || x.material_id===materialId) &&
    (!search.trim() || [x.material_name,x.material_code,x.project_name,x.building_name]
      .some(v=>v?.toLowerCase().includes(search.toLowerCase().trim()))));
  const totals=rows.reduce((a,x)=>({
    issued:a.issued+Number(x.issued_value),returned:a.returned+Number(x.returned_value),net:a.net+Number(x.net_value),
  }),{issued:0,returned:0,net:0});
  const selectedMaterialRows=all.filter(x=>
    (!materialId||x.material_id===materialId) &&
    (!buildingId||(buildingId==="general"?!x.building_id:x.building_id===buildingId)));
  // RPC already limits all to chosen project, but the warehouse total is
  // deliberately company-wide across authorized stores, not project allocation.
  const selected=materialId&&!physicalStock.isLoading&&!physicalStock.error
    ? summarizeSelectedMaterial(selectedMaterialRows,
        (physicalStock.data??[]).map(x=>({
          warehouse_id:x.warehouse_id,quantity_on_hand:x.quantity_on_hand,warehouses:x.warehouses,
        })))
    : null;
  const byProject=[...rows.reduce((m,x)=>{
    const key=x.project_id;
    const existing=m.get(key);
    m.set(key,{name:x.project_name,value:(existing?.value??0)+Number(x.net_value),count:(existing?.count??0)+1});
    return m;
  },new Map<string,{name:string;value:number;count:number}>()).values()].sort((a,b)=>b.value-a.value);

  return <div className="pb-20">
    <PageHeader title="Project Material Consumption" subtitle="Net material usage = posted issues − posted returns, valued at issue-time weighted-average cost. Figures are grouped by project, building and material."
      actions={<Link to="/inventory/material-issues" className="text-sm font-medium text-primary hover:underline">View material issues →</Link>} />
    <div className="mb-4 flex flex-wrap gap-2">
      <select aria-label="Filter project" className={selectCls} value={projectId} onChange={e=>{setProjectId(e.target.value);setBuildingId("");setPage(0);}}>
        <option value="">All accessible projects</option>
        {projects.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <select aria-label="Filter building" className={selectCls} value={buildingId} onChange={e=>{setBuildingId(e.target.value);setPage(0);}}>
        <option value="">All buildings / general works</option><option value="general">General project work only</option>{buildings.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <select aria-label="Select material" className={selectCls} value={materialId}
        onChange={e=>{setMaterialId(e.target.value);setPage(0);}}>
        <option value="">All materials</option>
        {materials.map(m=><option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
      </select>
      <div className="flex min-w-[220px] flex-1 items-center rounded-md border bg-card px-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input aria-label="Filter materials" className="h-9 border-0 shadow-none focus-visible:ring-0" value={search}
          placeholder="Search material, project or building" onChange={e=>{setSearch(e.target.value);setPage(0);}} />
      </div>
    </div>
    {q.isLoading ? <Loading /> : q.error ? <p className="rounded-md border p-4 text-sm text-destructive">{errMsg(q.error)}</p> : <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Material issued" value={inr(totals.issued)} />
        <Stat label="Material returned" value={inr(totals.returned)} />
        <Stat label="Net consumed value" value={inr(totals.net)} />
      </div>
      {materialId && <section className="mb-5 rounded-xl border bg-card p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold"><PackageCheck className="h-5 w-5 text-primary"/>
          {materials.find(x=>x.id===materialId)?.name??"Selected material"} · Usage & stock</h2>
        {physicalStock.isLoading?<div className="mt-3"><Loading/></div>:
          physicalStock.error?<p role="alert" className="mt-3 text-sm text-destructive">
            Could not verify physical stock. No stock quantity shown: {errMsg(physicalStock.error)}</p>:
          selected&&<>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Issued to selected project/building scope</p>
                <p className="mt-1 text-xl font-semibold">{num(selected.issued)} {materials.find(x=>x.id===materialId)?.unit}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Net consumed (after returns)</p>
                <p className="mt-1 text-xl font-semibold">{num(selected.used)} {materials.find(x=>x.id===materialId)?.unit}</p>
                <p className="text-xs text-muted-foreground">Returned {num(selected.returned)} · Cost {inr(selected.cost)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="flex items-center gap-1 text-xs text-muted-foreground"><Boxes className="h-3.5 w-3.5"/>On hand across accessible stores</p>
                <p className="mt-1 text-xl font-semibold">{num(selected.onHand)} {materials.find(x=>x.id===materialId)?.unit}</p>
                <p className="text-xs text-muted-foreground">Company-wide, not allocated to the selected project</p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border p-3"><h3 className="text-sm font-semibold">Where was it used?</h3>
                {selected.byBuilding.length?<div className="mt-2 space-y-2">{selected.byBuilding.map(x=>
                  <div className="flex justify-between gap-2 border-b pb-2 text-xs" key={x.project+"|"+x.building}>
                    <span>{x.project} / {x.building}</span>
                    <strong>{num(x.netQuantity)} {materials.find(m=>m.id===materialId)?.unit}</strong>
                  </div>)}</div>:<p className="mt-2 text-xs text-muted-foreground">No posted material consumption in this scope.</p>}</div>
              <div className="rounded-lg border p-3"><h3 className="text-sm font-semibold">Where is the remaining stock?</h3>
                {selected.warehouses.length?<div className="mt-2 space-y-2">{selected.warehouses.map(x=>
                  <div className="flex justify-between gap-2 border-b pb-2 text-xs" key={x.name}>
                    <span>{x.name}</span><strong>{num(x.quantity)} {materials.find(m=>m.id===materialId)?.unit}</strong>
                  </div>)}</div>:<p className="mt-2 text-xs text-muted-foreground">No accessible store balance found.</p>}</div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Net used = issues − returns. Store balance reflects GRNs, opening stock, transfers, returns and adjustments.
              Do not calculate purchase receipts by adding stock to usage if materials moved between projects or stores.</p>
          </>}
      </section>}
      {!projectId && byProject.length>1 && <section className="mb-4 rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Project-wise net material costs</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{byProject.map(x=><div key={x.name} className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">{x.name}</p>
          <p className="mt-1 text-lg font-semibold">{inr(x.value)}</p>
          <p className="text-xs text-muted-foreground">{x.count} grouped material lines</p>
        </div>)}</div>
      </section>}
      {rows.length===0 ? <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        No posted material issue/return consumption found for these filters.
      </p> : <><p className="mb-2 text-xs text-muted-foreground sm:hidden">Swipe sideways to see every column →</p><div role="region" aria-label="Project consumption" tabIndex={0} className="overflow-x-auto rounded-xl border bg-card shadow-card">
        <table className="w-full min-w-[890px] text-sm">
          <thead className="border-b bg-muted/30 text-xs"><tr>
            <th className="p-3 text-left">Project</th><th className="p-3 text-left">Building</th>
            <th className="p-3 text-left">Material</th><th className="p-3 text-right">Issued qty</th>
            <th className="p-3 text-right">Returned qty</th><th className="p-3 text-right">Net qty</th>
            <th className="p-3 text-right">Issued value</th><th className="p-3 text-right">Return credit</th>
            <th className="p-3 text-right">Net cost</th>
          </tr></thead>
          <tbody>{rows.slice(page*PAGE,(page+1)*PAGE).map(x=><tr key={x.project_id+":"+(x.building_id??"")+":"+x.material_id} className="border-b last:border-0 hover:bg-muted/30">
            <td className="p-3">{x.project_name}</td>
            <td className="p-3">{x.building_name??"General project work"}</td>
            <td className="p-3">{x.material_name} <span className="text-xs text-muted-foreground">{x.material_code}</span></td>
            <td className="p-3 text-right tabular-nums">{num(x.issued_quantity)} {x.unit_code}</td>
            <td className="p-3 text-right tabular-nums">{num(x.returned_quantity)}</td>
            <td className="p-3 text-right tabular-nums font-medium">{num(x.net_quantity)}</td>
            <td className="p-3 text-right tabular-nums">{inr(x.issued_value)}</td>
            <td className="p-3 text-right tabular-nums">{inr(x.returned_value)}</td>
            <td className="p-3 text-right tabular-nums font-semibold">{inr(x.net_value)}</td>
          </tr>)}</tbody>
        </table>
      </div></>}
      <Pager page={page} total={rows.length} size={PAGE} onPage={setPage} />
      <p className="mt-3 text-xs text-muted-foreground">This operational report tracks the consumption of materials from stock. It is not a second purchase invoice, cash-flow record or general-ledger expense posting.</p>
    </>}
  </div>;
}
