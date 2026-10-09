import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, Boxes, ChartColumnIncreasing, IndianRupee, RefreshCcw, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { inr, num, errMsg } from "@/lib/format";
import { loadCompleteRows } from "@/lib/complete-register";
import { summarizeManagement } from "@/lib/management-overview";
import { PageHeader, Loading, SearchBox } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { Button } from "@/components/ui/button";
import { selectCls } from "@/lib/po";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_shell/management")({
  head: () => ({ meta: [{ title: "Management Overview — KK GROUP ERP" }, { name: "description", content: "Read-only material locations and financial overview." }] }),
  component: ManagementOverview,
});

const PAGE_SIZE = 20;

function ManagementOverview() {
  const me = useMe();
  const companyId = me.data?.profile.company_id;
  const permissions = me.data?.permissions;
  const allowed = !!permissions?.has("inventory.view") && !!permissions?.has("payable.view") && !!permissions?.has("payment.view");
  const [search, setSearch] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [page, setPage] = useState(0);

  const q = useQuery({
    queryKey: ["management-overview", companyId],
    enabled: !!companyId && allowed,
    staleTime: 60_000,
    queryFn: async () => {
      if (!companyId) throw new Error("Choose a company before viewing its management report.");
      const [stock, projects, consumed, invoices, payments] = await Promise.all([
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
      ]);
      const summary = summarizeManagement(stock, consumed, invoices, payments);
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
    const needle = search.trim().toLocaleLowerCase();
    return (!warehouse || row.warehouse_id === warehouse) &&
      (!needle || [name, code, storeName].some(value => value.toLocaleLowerCase().includes(needle)));
  });
  const filteredPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const pageRows = filtered.slice(filteredPage * PAGE_SIZE, (filteredPage + 1) * PAGE_SIZE);
  const projectRows = (data?.projects ?? []).map(project => ({
    ...project,
    consumed: data?.summary.projectUsage.get(project.id) ?? 0,
  })).sort((a, b) => b.consumed - a.consumed);

  return <div className="pb-16">
    <PageHeader title="Management Overview"
      subtitle="Your construction materials, their current locations and separately tracked financial figures."
      actions={<Button size="sm" variant="outline" disabled={q.isFetching} onClick={() => q.refetch()}>
        <RefreshCcw className="mr-2 h-4 w-4" />Refresh</Button>} />

    {q.isLoading ? <Loading /> : q.error ? (
      <div role="alert" className="rounded-xl border border-destructive/40 p-5 text-sm text-destructive">
        Management totals cannot be verified. Partial results are not displayed. {errMsg(q.error)}
        <Button size="sm" variant="outline" className="ml-3" onClick={() => q.refetch()}>Retry</Button>
      </div>
    ) : data ? <>
      <p className="mb-4 text-xs text-muted-foreground">Read-only report · Figures reflect posted records at last refresh; they are not a single accounting snapshot.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Stock on hand", value: data.summary.stockValue, hint: "Value of material currently in stores", icon: Boxes },
          { label: "Material used on projects", value: data.summary.materialUsageCost, hint: "Issued materials minus returns at issue cost", icon: ChartColumnIncreasing },
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
        These four amounts must <strong>not</strong> be added together. “Material used” is recorded material cost, not total company expense.
        Bills and payments can relate to the same purchases. Labour, contractor bills and overheads are not included unless separately recorded.
      </p>

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
                <td className="px-4 py-3 font-medium">{x.items?.name ?? "Material"}<span className="ml-2 text-xs text-muted-foreground">{x.items?.code}</span></td>
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

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Project-wise material usage</h2>
          <Link to="/reports/project-cost-control" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            Cost control <ArrowRight className="h-4 w-4" /></Link>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {projectRows.length === 0 && <p className="text-sm text-muted-foreground">No projects have been entered.</p>}
          {projectRows.map(project => <div key={project.id} className="rounded-xl border bg-card p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="truncate font-semibold">{project.name}</div><div className="text-xs text-muted-foreground">{project.code}</div></div>
              <div className="text-right"><div className="text-[11px] text-muted-foreground">Material consumed</div><div className="font-semibold tabular-nums">{inr(project.consumed)}</div></div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">Project budget: {Number(project.budget) > 0 ? inr(project.budget) : "Not set"}</div>
          </div>)}
        </div>
      </section>
      <div className="mt-6 rounded-lg border p-4 text-sm text-muted-foreground">
        Approved supplier bills (lifetime): <strong className="text-foreground">{inr(data.summary.approvedSupplierBills)}</strong>.
        View <Link to="/finance/payables" className="font-semibold text-primary underline">Payables</Link> and
        <Link to="/finance/payments" className="ml-1 font-semibold text-primary underline">Payments</Link> for document details.
      </div>
    </> : null}
  </div>;
}
