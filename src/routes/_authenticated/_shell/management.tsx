import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { ArrowRight, Boxes, ChartColumnIncreasing, IndianRupee, RefreshCcw, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { inr, num, errMsg } from "@/lib/format";
import { loadCompleteRows } from "@/lib/complete-register";
import { summarizeManagement, emptyHistoricalUsage } from "@/lib/management-overview";
import { PageHeader, Loading, SearchBox } from "@/components/erp/common";
import { matchesRecordSearch } from "@/lib/erp-search";
import { Pager } from "@/components/erp/pager";
import { Button } from "@/components/ui/button";
import { selectCls } from "@/lib/po";
import { cn } from "@/lib/utils";
import { canAccessPage } from "@/lib/page-access";
const BudgetPanel = lazy(() => import("@/components/erp/project-cost-control-panel").then(m => ({default:m.ProjectCostControl})));

export const Route = createFileRoute("/_authenticated/_shell/management")({
  head: () => ({ meta: [{ title: "Project Overview — KK GROUP ERP" }, { name: "description", content: "Read-only material locations and financial overview." }] }),
  component: ManagementOverview,
});

const PAGE_SIZE = 20;

function ManagementOverview() {
  const me = useMe();
  const companyId = me.data?.profile.company_id;
  const permissions = me.data?.permissions;
  const allowed = !!permissions?.has("inventory.view") && !!permissions?.has("payable.view") && !!permissions?.has("payment.view");
  const historicalAllowed = !!permissions?.has("vendor_invoice.view") && !!permissions?.has("materials.view");
  const access = {roles: me.data?.roles ?? [], permissions: permissions ?? new Set<string>()};
  const canBudget = canAccessPage("/reports/project-cost-control", access);
  const [tab, setTab] = useState<"overview"|"stock"|"budget">("overview");
  const activeTab = tab === "budget" && !canBudget ? "overview" : tab;
  const [projectSearch, setProjectSearch] = useState("");
  const [search, setSearch] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [page, setPage] = useState(0);

  const q = useQuery({
    queryKey: ["management-overview", companyId, me.data?.profile.id, historicalAllowed],
    enabled: !!companyId && allowed && activeTab !== "budget",
    staleTime: 60_000,
    queryFn: async () => {
      if (!companyId) throw new Error("Choose a company before viewing its management report.");
      const [stock, projects, consumed, invoices, payments, historical] = await Promise.all([
        loadCompleteRows(async (start, end) => {
          const { data, count, error } = await supabase.from("warehouse_stock")
            .select("warehouse_id,material_id,quantity_on_hand,total_value,warehouses!inner(name,code,project_id,company_id),items(code,name,units_of_measure(code))", { count: "exact" })
            .eq("warehouses.company_id", companyId)
            .order("warehouse_id").order("material_id").range(start, end);
          return { data: data?.map(row => ({ ...row, id: row.warehouse_id + ":" + row.material_id })) ?? null, count, error };
        }),
        loadCompleteRows(async (start, end) => await supabase.from("projects")
          .select("id,code,name,budget", { count: "exact" })
          .eq("company_id", companyId).order("id").range(start, end)),
        loadCompleteRows(async (start, end) => {
          const { data, count, error } = await supabase.rpc(
            "project_material_consumption", { _project_id: null as unknown as string }, { count: "exact" },
          ).order("project_id").order("building_id").order("material_id").range(start, end);
          return { data: data?.map(row => ({ ...row, id: [row.project_id, row.building_id ?? "", row.material_id].join(":") })) ?? null, count, error };
        }),
        loadCompleteRows(async (start, end) => await supabase.from("vendor_invoices")
          .select("id,net_payable,balance_due", { count: "exact" })
          .eq("company_id", companyId)
          .in("status", ["approved", "partially_paid", "paid"])
          .order("id").range(start, end)),
        loadCompleteRows(async (start, end) => await supabase.from("vendor_payments")
          .select("id,amount", { count: "exact" })
          .eq("company_id", companyId).eq("status", "recorded")
          .order("id").range(start, end)),
        historicalAllowed ? loadCompleteRows(async (start,end) => await supabase.from("opening_vendor_invoice_lines")
          .select("id,taxable,material_id,items(item_categories(name)),vendor_invoices!inner(project_id,company_id,status,is_opening,po_id)", {count:"exact"})
          .eq("vendor_invoices.company_id",companyId).eq("vendor_invoices.is_opening",true).is("vendor_invoices.po_id",null)
          .in("vendor_invoices.status",["approved","partially_paid","paid","pending_review","exception"])
          .order("id").range(start,end)) : Promise.resolve([]),
      ]);
      const summary = summarizeManagement(stock, consumed, invoices, payments, historical.map(row => {
        const invoice = row.vendor_invoices;
        if (!invoice) throw new Error("Historical invoice project could not be verified.");
        return { id: row.id, project_id: invoice.project_id, status: invoice.status, is_opening: invoice.is_opening,
          po_id: invoice.po_id, taxable: row.taxable, material_id: row.material_id, category: row.items?.item_categories?.name ?? null };
      }));
      return { stock, projects, consumed, invoices, payments, summary };
    },
  });

  if (me.isLoading) return <Loading />;
  if (me.error) return <p role="alert" className="p-4 text-sm text-destructive">{errMsg(me.error)}</p>;
  if (!allowed) return <div className="rounded-xl border p-6 text-sm">Your account does not have permission to view stock and finance summaries.</div>;
  if (!companyId) return <div className="rounded-xl border p-6 text-sm">Your account is not assigned to a company.</div>;

  const data = q.data;
  const locations = data?.stock.filter(row => Number(row.quantity_on_hand) > 0) ?? [];
  const projectNames = new Map(data?.projects.map(p => [p.id, p.name]) ?? []);
  const warehouses = [...new Map(locations.map(row => [row.warehouse_id, row.warehouses])).entries()]
    .map(([id, store]) => ({ id, name: store?.name ?? "Unnamed store", projectId: store?.project_id ?? null }));
  const filtered = locations.filter(row => {
    const name = row.items?.name ?? "";
    const code = row.items?.code ?? "";
    const storeName = row.warehouses?.name ?? "";
    return (!warehouse || row.warehouse_id === warehouse) &&
      matchesRecordSearch([name,code,storeName],search);
  });
  const filteredPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const pageRows = filtered.slice(filteredPage * PAGE_SIZE, (filteredPage + 1) * PAGE_SIZE);
  const projectRows = (data?.projects ?? []).map(project => ({
    ...project,
    consumed: data?.summary.projectUsage.get(project.id) ?? 0,
    historical: data?.summary.historicalByProject.get(project.id) ?? emptyHistoricalUsage(),
  })).map(p=>({...p,total:p.consumed+p.historical.approved+p.historical.pending})).sort((a,b)=>b.total-a.total);

  return <div className="pb-16">
    <PageHeader title="Project Overview"
      subtitle="One reporting workspace for project costs, inventory and budget commitments."
      actions={activeTab !== "budget" && <Button size="sm" variant="outline" disabled={q.isFetching} onClick={() => q.refetch()}>
        <RefreshCcw className="mr-2 h-4 w-4" />Refresh</Button>} />

    <div className="mb-5 flex flex-wrap gap-2 border-b pb-3" role="group" aria-label="Project report views">
      {([{key:"overview",label:"Project summary"},{key:"stock",label:"Stock locations"},...(canBudget?[{key:"budget",label:"Budget & commitments"}]:[])] as const).map(item=><Button key={item.key} type="button" variant={activeTab===item.key?"default":"outline"} aria-pressed={activeTab===item.key} onClick={()=>setTab(item.key as "overview"|"stock"|"budget")}>{item.label}</Button>)}
      {canAccessPage("/projects",access)&&<Link to="/projects" className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Project setup <ArrowRight className="h-4 w-4"/></Link>}
    </div>
    {activeTab==="budget" && canBudget ? <Suspense fallback={<Loading/>}><BudgetPanel embedded/></Suspense> : q.isLoading ? <Loading /> : q.error ? (
      <div role="alert" className="rounded-xl border border-destructive/40 p-5 text-sm text-destructive">
        Management totals cannot be verified. Partial results are not displayed. {errMsg(q.error)}
        <Button size="sm" variant="outline" className="ml-3" onClick={() => q.refetch()}>Retry</Button>
      </div>
    ) : data ? <>
      {activeTab==="overview" ? <>
      <p className="mb-4 text-xs text-muted-foreground">Read-only report · Figures reflect posted records at last refresh; they are not a single accounting snapshot.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Stock on hand", value: data.summary.stockValue, hint: "Value of material currently in stores", icon: Boxes },
          { label: historicalAllowed ? "Recorded material cost" : "Material used on projects", value: data.summary.recordedMaterialCost, hint: historicalAllowed ? "Stock issues net of returns + historical materials (including pending bills)" : "Issued materials minus returns at issue cost", icon: ChartColumnIncreasing },
          { label: "Supplier bills outstanding", value: data.summary.unpaidSupplierBills, hint: "Approved invoices remaining unpaid", icon: Wallet },
          { label: "Payments recorded", value: data.summary.cashPaid, hint: "Cash outflow, including any advances", icon: IndianRupee },
        ].map(metric => <div className="rounded-xl border bg-card p-5 shadow-card" key={metric.label}>
          <metric.icon className="mb-3 h-5 w-5 text-primary" aria-hidden />
          <div className="text-xs font-medium text-muted-foreground">{metric.label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{inr(metric.value)}</div>
          <p className="mt-2 text-xs text-muted-foreground">{metric.hint}</p>
        </div>)}
      </div>
      <p className="mt-3 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        These four amounts must <strong>not</strong> be added together. Recorded material cost includes stock issues and eligible old bills without a PO, valued before GST. Historical bills are treated as consumed based on the reporting policy; pending bills are provisional, not approved costs.
        Bills and payments can relate to the same purchases. Services and unclassified old bill lines are shown separately, not added to the material total. No stock balances are changed.
      </p>

      {historicalAllowed ? <div className="mt-3 grid gap-2 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-xs text-muted-foreground">Stock issues net of returns</p><strong>{inr(data.summary.materialUsageCost)}</strong></div>
        <div><p className="text-xs text-muted-foreground">Approved historical materials</p><strong>{inr(data.summary.historicalUsage.approved)}</strong></div>
        <div><p className="text-xs text-muted-foreground">Historical materials pending review</p><strong>{inr(data.summary.historicalUsage.pending)}</strong></div>
        <div><p className="text-xs text-muted-foreground">Other old bill costs (excluded)</p><strong>{inr(data.summary.historicalUsage.services+data.summary.historicalUsage.unclassified)}</strong></div>
      </div> : <p className="mt-3 text-xs text-muted-foreground">Historical invoice detail is not included because your role lacks invoice or material viewing permission.</p>}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Project-wise material usage</h2>
          {canBudget&&<Button size="sm" variant="ghost" onClick={()=>setTab("budget")}>Budget & commitments <ArrowRight className="h-4 w-4"/></Button>}
        </div>
        <div className="mb-3 max-w-md"><SearchBox value={projectSearch} onChange={setProjectSearch} placeholder="Search project name or code"/></div>
        <div className="grid gap-3 md:grid-cols-2">
          {projectRows.filter(p=>matchesRecordSearch([p.name,p.code],projectSearch)).length === 0 && <p className="text-sm text-muted-foreground">No matching projects.</p>}
          {projectRows.filter(p=>matchesRecordSearch([p.name,p.code],projectSearch)).map(project => <div key={project.id} className="rounded-xl border bg-card p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="truncate font-semibold">{project.name}</div><div className="text-xs text-muted-foreground">{project.code}</div></div>
              <div className="text-right"><div className="text-[11px] text-muted-foreground">{historicalAllowed?"Recorded material cost":"Material consumed"}</div><div className="font-semibold tabular-nums">{inr(project.total)}</div></div>
            </div>
            {historicalAllowed && <div className="mt-3 space-y-1 border-t pt-3 text-xs">
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Stock issues net of returns</span><span className="tabular-nums">{inr(project.consumed)}</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Approved old material bills</span><span className="tabular-nums">{inr(project.historical.approved)}</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Old material bills pending review</span><span className="tabular-nums">{inr(project.historical.pending)}</span></div>
              {(project.historical.services!==0||project.historical.unclassified!==0)&&<div className="flex justify-between gap-2 text-muted-foreground"><span>Services / unclassified (excluded)</span><span className="tabular-nums">{inr(project.historical.services+project.historical.unclassified)}</span></div>}
            </div>}
            <div className="mt-2 text-xs text-muted-foreground">Project budget: {Number(project.budget) > 0 ? inr(project.budget) : "Not set"}</div>
          </div>)}
        </div>
      </section>
      <div className="mt-6 rounded-lg border p-4 text-sm text-muted-foreground">
        Approved supplier bills (lifetime): <strong className="text-foreground">{inr(data.summary.approvedSupplierBills)}</strong>.
        View <Link to="/finance/payables" className="font-semibold text-primary underline">Payables</Link> and
        <Link to="/finance/payments" className="ml-1 font-semibold text-primary underline">Payments</Link> for document details.
      </div>
      </> : <>
      <div className="mb-3 rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Stock on hand value</p><p className="text-xl font-semibold tabular-nums">{inr(data.summary.stockValue)}</p></div>
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Where is each material?</h2>
          <Link className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" to="/inventory/stock">Full stock register <ArrowRight className="h-4 w-4" /></Link>
        </div>
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="w-full"><SearchBox value={search} onChange={v => { setSearch(v); setPage(0); }} placeholder="Search material or store" /></div>
          <select aria-label="Store" className={cn(selectCls, "h-11")} value={warehouse} onChange={e => { setWarehouse(e.target.value); setPage(0); }}>
            <option value="">All stores</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <div className="flex items-center rounded-lg border px-4 text-sm text-muted-foreground">{filtered.length} material locations · {warehouses.length} stores</div>
        </div>
        <div className="doc-table overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr>
              <th className="px-4 py-3">Material</th><th className="px-4 py-3">Stored at</th>
              <th className="px-4 py-3">Project</th><th className="px-4 py-3 text-right">Available</th>
              <th className="px-4 py-3 text-right">Stock value</th></tr></thead>
            <tbody>
              {pageRows.length === 0 && <tr><td colSpan={5} className="p-5 text-muted-foreground">No material stock matches. Materials appear after opening stock or posted receipts are entered.</td></tr>}
              {pageRows.map(x => <tr key={x.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">{x.items?.name ?? "Material"}</td>
                <td className="px-4 py-3">{x.warehouses?.name ?? "Unknown store"}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{x.warehouses?.project_id ? projectNames.get(x.warehouses.project_id) ?? "Project" : "Shared / central store"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{num(x.quantity_on_hand)} {x.items?.units_of_measure?.code ?? ""}</td>
                <td className="px-4 py-3 text-right tabular-nums">{inr(x.total_value)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <Pager page={filteredPage} total={filtered.length} size={PAGE_SIZE} onPage={setPage} />
      </section>

      </>}
    </> : null}
  </div>;
}
