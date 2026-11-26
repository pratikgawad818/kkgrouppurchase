import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Search, PackageMinus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCan } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loading, PageHeader } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, fmtDate, inr, num } from "@/lib/format";
import { selectCls } from "@/lib/po";
import { PAGE } from "@/lib/fy";
import { loadCompleteRows } from "@/lib/complete-register";
import { prepareRecordSearch, matchesRecordSearch, visibleSearchPage } from "@/lib/erp-search";

export const Route = createFileRoute("/_authenticated/_shell/inventory/material-issues/")({
  component: MaterialIssues,
  head: () => ({ meta: [{ title: "Material Issues — KK GROUP ERP" }] }),
});

function MaterialIssues() {
  const can = useCan();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [issuedTo, setIssuedTo] = useState("");
  const [purpose, setPurpose] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [findMaterial, setFindMaterial] = useState("");
  const [page, setPage] = useState(0);
  const [materialPage, setMaterialPage] = useState(0);

  const register = useQuery({
    queryKey: ["material-issues"],
    queryFn: async () => {
      return loadCompleteRows(async (start,end) =>
        await supabase.from("material_issues")
          .select("id,issue_number,issue_date,project_id,building_id,warehouse_id,issued_to,purpose,projects(name),buildings(name),warehouses(name),material_issue_items(quantity,total_cost)",{count:"exact"})
          .order("created_at",{ascending:false}).order("id",{ascending:false}).range(start,end)
      );
    },
  });
  const context = useQuery({
    queryKey: ["material-issue-form-context"],
    enabled: show,
    queryFn: async () => {
      const [projects, buildings, warehouses] = await Promise.all([
        loadCompleteRows(async (start,end) => await supabase.from("projects").select("id,name,company_id",{count:"exact"}).eq("record_status", "active").order("name").order("id").range(start,end)),
        loadCompleteRows(async (start,end) => await supabase.from("buildings").select("id,name,project_id",{count:"exact"}).order("name").order("id").range(start,end)),
        loadCompleteRows(async (start,end) => await supabase.from("warehouses").select("id,name,company_id,project_id",{count:"exact"}).eq("status", "active").order("name").order("id").range(start,end)),
      ]);
      return { projects, buildings, warehouses };
    },
  });
  const project = context.data?.projects.find(x => x.id === projectId);
  const warehouses = (context.data?.warehouses ?? []).filter(x =>
    project && x.company_id === project.company_id && (!x.project_id || x.project_id === projectId));
  const eligibleWarehouse = warehouses.some(x => x.id === warehouseId);
  const warehouseStock = useQuery({
    queryKey: ["material-issue-stock", warehouseId],
    enabled: show && eligibleWarehouse && context.isSuccess && !context.isFetching,
    queryFn: async () => loadCompleteRows(async (start, end) => {
      // warehouse_stock has a composite key; material_id is unique within this warehouse.
      const result = await supabase.from("warehouse_stock")
        .select("warehouse_id,material_id,quantity_on_hand,weighted_avg_cost,items(name,code,units_of_measure(code))", { count: "exact" })
        .eq("warehouse_id", warehouseId).gt("quantity_on_hand", 0)
        .order("material_id").range(start,end);
      return { ...result, data: result.data?.map(row => ({...row,id:row.material_id})) ?? null };
    }),
    staleTime: 0,
  });
  const stock = warehouseStock.data ?? [];
  const prepared = prepareRecordSearch(findMaterial);
  const materials = stock.filter(x => matchesRecordSearch([x.items?.name,x.items?.code], prepared));
  const visibleMaterialPage = visibleSearchPage(materialPage, materials.length, PAGE);
  const selectedCount = Object.values(amounts).filter(value => value.trim() !== "").length;
  const matched = (register.data ?? []).filter(x => matchesRecordSearch(
    [x.issue_number,x.issued_to,x.purpose,x.projects?.name,x.buildings?.name,x.warehouses?.name],filter
  ));
  const visiblePage=visibleSearchPage(page,matched.length,PAGE);
  const create = useMutation({
    mutationFn: async () => {
      if (!projectId || !warehouseId) throw new Error("Choose a project and source store");
      if (!context.isSuccess || context.isFetching || !eligibleWarehouse || !warehouseStock.isSuccess || warehouseStock.isFetching) throw new Error("Verify the selected store and its available stock before posting.");
      if (buildingId && !context.data.buildings.some(x => x.id === buildingId && x.project_id === projectId)) throw new Error("Choose a building belonging to the selected project.");
      if (Object.entries(amounts).some(([id,value]) => value.trim() && !stock.some(x => x.material_id === id))) throw new Error("Selected material is no longer available. Review the quantities before posting.");
      const lines = stock.flatMap(x => {
        const raw = amounts[x.material_id];
        if (!raw || raw.trim() === "") return [];
        const qty = Number(raw);
        if (!Number.isFinite(qty) || qty <= 0 || qty > Number(x.quantity_on_hand)
          || Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-6) {
          throw new Error(`Invalid issue quantity for ${x.items?.name}. Available: ${num(x.quantity_on_hand)}`);
        }
        return [{ material_id: x.material_id, quantity: qty }];
      });
      if (!issuedTo.trim() || !purpose.trim()) throw new Error("Enter who is receiving the materials and the work purpose.");
      if (!lines.length) throw new Error("Enter a quantity for at least one material.");
      const { data, error } = await supabase.rpc("record_material_issue", {
        _warehouse_id: warehouseId, _project_id: projectId as string, _building_id: (buildingId || null) as unknown as string,
        _issued_to: issuedTo.trim(), _purpose: purpose.trim(), _items: lines,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: id => {
      toast.success("Material issue posted to the stock ledger");
      ["material-issues","material-issue","project-material-consumption","stock","stock-ledger","material-issue-stock"].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      setShow(false); setAmounts({}); setIssuedTo(""); setPurpose(""); setWarehouseId("");
      navigate({ to: "/inventory/material-issues/$id", params: { id } });
    },
    onError: error => toast.error(errMsg(error)),
  });

  return <>
    <PageHeader title="Material Issues" subtitle="Record materials taken from a store for a specific project or building. Each posting reduces physical stock and records a project consumption cost."
      actions={<div className="flex gap-2">
        <Link to="/inventory/material-consumption"><Button size="sm" variant="outline">Project consumption</Button></Link>
        {can("inventory.issue") && <Button size="sm" onClick={() => setShow(true)}><Plus className="mr-1 h-4 w-4" />Issue materials</Button>}
      </div>} />
    <div className="mb-3 flex items-center gap-2 rounded-md border bg-card px-3 py-1.5">
      <Search className="h-4 w-4 text-muted-foreground" />
      <Input aria-label="Search issued materials" className="h-8 border-0 shadow-none focus-visible:ring-0" value={filter} placeholder="Issue number, site, recipient or project" onChange={e => {setFilter(e.target.value);setPage(0);}} />
    </div>
    {register.isLoading ? <Loading /> : register.error ? <p className="text-sm text-destructive">{errMsg(register.error)}</p> :
    !matched.length ? <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
      <PackageMinus className="mx-auto mb-2 h-7 w-7" />No material issues found.
    </div> : <div className="doc-table overflow-x-auto rounded-xl border bg-card shadow-card">
      <table className="w-full text-left text-sm"><thead className="border-b bg-muted/40 text-xs">
        <tr><th className="p-3">Issue</th><th className="p-3">Date</th><th className="p-3">Project / building</th><th className="p-3">Store</th><th className="p-3">Issued to</th><th className="p-3 text-right">Issue value</th></tr>
      </thead><tbody>{matched.slice(visiblePage * PAGE, (visiblePage + 1)*PAGE).map(x => <tr key={x.id} className="border-b last:border-0 hover:bg-muted/30">
        <td className="p-3 font-medium"><Link className="text-primary hover:underline" to="/inventory/material-issues/$id" params={{ id: x.id }}>{x.issue_number}</Link></td>
        <td className="p-3">{fmtDate(x.issue_date)}</td>
        <td className="p-3">{x.projects?.name}{x.buildings?.name ? ` / ${x.buildings.name}` : ""}</td>
        <td className="p-3">{x.warehouses?.name}</td>
        <td className="p-3">{x.issued_to}</td>
        <td className="p-3 text-right tabular-nums">{inr((x.material_issue_items ?? []).reduce((a,i) => a + Number(i.total_cost),0))}</td>
      </tr>)}</tbody></table>
    </div>}
    <Pager page={visiblePage} total={matched.length} size={PAGE} onPage={setPage} />
    <Dialog open={show} onOpenChange={value => { if (!value && !create.isPending) setShow(false); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Issue materials to site</DialogTitle>
          <DialogDescription>This is an immediate audited stock deduction, not a draft. An incorrect issue must be corrected by an authorised return, not by editing the ledger.</DialogDescription>
        </DialogHeader>
        {context.isLoading ? <Loading /> : context.error ? <p className="text-sm text-destructive">{errMsg(context.error)}</p> : <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="mi-project" className="text-sm font-medium">Project *</label>
              <select id="mi-project" className={selectCls} value={projectId} onChange={e => {setProjectId(e.target.value);setBuildingId("");setWarehouseId("");setAmounts({});setMaterialPage(0);setFindMaterial("");}}>
                <option value="">Choose project</option>{context.data?.projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></div>
            <div><label htmlFor="mi-building" className="text-sm font-medium">Building / wing</label>
              <select id="mi-building" className={selectCls} value={buildingId} onChange={e => setBuildingId(e.target.value)}>
                <option value="">General project work</option>{context.data?.buildings.filter(x=>x.project_id===projectId).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
              </select></div>
            <div className="sm:col-span-2"><label htmlFor="mi-store" className="text-sm font-medium">Source store *</label>
              <select id="mi-store" className={selectCls} value={warehouseId} onChange={e => {setWarehouseId(e.target.value);setAmounts({});setMaterialPage(0);setFindMaterial("");}}>
                <option value="">Choose store</option>{warehouses.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></div>
            <div><label htmlFor="mi-to" className="text-sm font-medium">Materials handed to *</label>
              <Input id="mi-to" maxLength={120} placeholder="Site engineer / contractor name" value={issuedTo} onChange={e=>setIssuedTo(e.target.value)} /></div>
            <div><label htmlFor="mi-purpose" className="text-sm font-medium">Work / usage purpose *</label>
              <Input id="mi-purpose" maxLength={500} placeholder="e.g. Tower A, slab casting" value={purpose} onChange={e=>setPurpose(e.target.value)} /></div>
          </div>
          {warehouseId && <div className="mt-3">
            <Input aria-label="Filter store materials" className="mb-2" placeholder="Search materials in selected store" value={findMaterial} onChange={e=>{setFindMaterial(e.target.value);setMaterialPage(0);}} />
            {warehouseStock.isFetching && <p role="status" className="mb-2 text-xs text-muted-foreground">Verifying available stock…</p>}
            {warehouseStock.error && <p role="alert" className="mb-2 text-sm text-destructive">{errMsg(warehouseStock.error)} <button type="button" className="underline" onClick={()=>void warehouseStock.refetch()}>Retry</button></p>}
            <p className="mb-2 text-xs text-muted-foreground">{selectedCount} material quantities entered across all pages.</p>
            <div className="doc-table max-h-72 overflow-y-auto rounded-md border max-sm:max-h-[60vh]">
              {warehouseStock.isLoading ? <Loading /> : warehouseStock.error ? null : !materials.length ? <p className="p-4 text-sm text-muted-foreground">No available stock found in this store.</p> :
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b bg-muted/90 text-xs"><tr><th className="p-2 text-left">Material</th><th className="p-2 text-right">Available</th><th className="p-2 text-right">Avg. cost</th><th className="p-2 text-right">Issue qty</th></tr></thead>
                <tbody>{materials.slice(visibleMaterialPage * PAGE,(visibleMaterialPage+1)*PAGE).map(x=><tr key={x.material_id} className="border-b last:border-0">
                  <td className="p-2">{x.items?.name}</td>
                  <td className="p-2 text-right tabular-nums">{num(x.quantity_on_hand)} {x.items?.units_of_measure?.code}</td>
                  <td className="p-2 text-right tabular-nums">{inr(x.weighted_avg_cost)}</td>
                  <td className="p-2"><Input inputMode="decimal" type="number" min={0} step="0.001" max={x.quantity_on_hand}
                    className="ml-auto h-9 w-28 text-right" aria-label={`Issue quantity for ${x.items?.name}`}
                    value={amounts[x.material_id] ?? ""} onChange={e=>setAmounts({...amounts,[x.material_id]:e.target.value})} placeholder="0" /></td>
                </tr>)}</tbody></table>}
            </div>
            {warehouseStock.isSuccess && <Pager page={visibleMaterialPage} total={materials.length} size={PAGE} onPage={setMaterialPage} />}
          </div>}
          <p className="mt-2 text-xs text-muted-foreground">Unit costs use the store's weighted average at posting time. Source store, project and building are validated again by the database.</p>
        </>}
        <DialogFooter><Button variant="outline" disabled={create.isPending} onClick={()=>setShow(false)}>Cancel</Button>
          <Button disabled={create.isPending || !context.isSuccess || context.isFetching || !eligibleWarehouse || !warehouseStock.isSuccess || warehouseStock.isFetching || !warehouseId} onClick={()=> {
            if (window.confirm("Post this material issue and reduce warehouse stock? This cannot be edited afterwards.")) create.mutate();
          }}>Post material issue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
