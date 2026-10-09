import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowUpRight, AlertTriangle, ChartNoAxesCombined, ClipboardList, PackageCheck, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Empty, Loading, Progress, Stat, SearchBox } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, inr } from "@/lib/format";
import { useMe } from "@/lib/session";
import { selectCls, type PoStatus } from "@/lib/po";
import { type InvoiceStatus } from "@/lib/finance";
import { ACTIVE_DELIVERY_PO_STATUSES } from "@/lib/procurement-followup";
import { summarizeProjectCosts, type CostProjectTotals } from "@/lib/project-cost-control";
import { PAGE } from "@/lib/fy";
import { cn } from "@/lib/utils";

const MAX_ROWS = 3000;
const BATCH = 500;
const PO_STATES: PoStatus[] = [...ACTIVE_DELIVERY_PO_STATUSES];
const BILL_STATES: InvoiceStatus[] = ["approved", "partially_paid", "paid"];

/** Explicit pagination avoids quietly treating Supabase's default 1,000-row
 * API cap as a complete data set for construction finance reporting.
 */
async function loadPages<T>(fetchPage: (offset: number) => Promise<T[]>): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += BATCH) {
    const page = await fetchPage(offset);
    rows.push(...page);
    if (page.length < BATCH) return { rows, capped: false };
  }
  return { rows, capped: true };
}

export const Route = createFileRoute("/_authenticated/_shell/reports/project-cost-control")({
  head: () => ({ meta: [{ title: "Project Cost Control — KK GROUP ERP" }] }),
  component: ProjectCostControl,
});

function ProjectCostControl() {
  const me = useMe();
  const can = (permission: string) => !!me.data?.permissions.has(permission);
  const canFinancial = can("financial.view");
  const canPo = can("purchase_order.view");
  const canInventory = can("inventory.view");
  const canPayables = can("payable.view");
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("material_share");
  const [page, setPage] = useState(0);

  const projectsQ = useQuery({
    queryKey: ["project-cost-control", "projects"],
    enabled: canFinancial,
    staleTime: 60_000,
    queryFn: () => loadPages(async offset => {
      const { data, error } = await supabase.from("projects")
        .select("id,code,name,status,budget,estimated_cost")
        .order("id")
        .range(offset, offset + BATCH - 1);
      if (error) throw error;
      return data ?? [];
    }),
  });

  const posQ = useQuery({
    queryKey: ["project-cost-control", "purchase-orders"],
    enabled: canFinancial && canPo,
    staleTime: 60_000,
    queryFn: () => loadPages(async offset => {
      const { data, error } = await supabase.from("purchase_orders")
        .select("project_id,status,purchase_order_items(ordered_quantity,accepted_quantity,short_closed_quantity,line_total)")
        .in("status", PO_STATES).order("id")
        .range(offset, offset + BATCH - 1);
      if (error) throw error;
      return data ?? [];
    }),
  });

  const consumptionQ = useQuery({
    queryKey: ["project-cost-control", "material-consumption"],
    enabled: canFinancial && canInventory,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("project_material_consumption", { _project_id: null as unknown as string });
      if (error) throw error;
      return { rows: data ?? [], possiblyCapped: (data?.length ?? 0) >= 1000 };
    },
  });

  const invoicesQ = useQuery({
    queryKey: ["project-cost-control", "approved-vendor-invoices"],
    enabled: canFinancial && canPayables,
    staleTime: 60_000,
    queryFn: () => loadPages(async offset => {
      const { data, error } = await supabase.from("vendor_invoices")
        .select("project_id,status,net_payable,balance_due")
        .in("status", BILL_STATES).order("id")
        .range(offset, offset + BATCH - 1);
      if (error) throw error;
      return data ?? [];
    }),
  });

  if (me.isLoading || (canFinancial && projectsQ.isLoading)) return <Loading />;
  if (!canFinancial) {
    return <>
      <PageHeader title="Project Cost Control" subtitle="Project budgets and purchasing exposure." />
      <Empty>Your role does not have financial viewing permission. Ask your administrator for access.</Empty>
    </>;
  }
  if (projectsQ.error) return <>
    <PageHeader title="Project Cost Control" />
    <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Cannot load project budgets: {errMsg(projectsQ.error)}</div>
  </>;

  const qLoading = (canPo && posQ.isLoading) || (canInventory && consumptionQ.isLoading) || (canPayables && invoicesQ.isLoading);
  const partialError = (canPo && posQ.error) || (canInventory && consumptionQ.error) || (canPayables && invoicesQ.error);

  const projectRows = projectsQ.data?.rows ?? [];
  const all = summarizeProjectCosts(projectRows,
    canPo && !posQ.error ? posQ.data?.rows ?? [] : [],
    canInventory && !consumptionQ.error ? consumptionQ.data?.rows ?? [] : [],
    canPayables && !invoicesQ.error ? invoicesQ.data?.rows ?? [] : []);

  const query = search.trim().toLowerCase();
  const filtered = all.filter(x =>
    (!projectId || x.project.id === projectId) &&
    (!status || x.project.status === status) &&
    (!query || [x.project.name, x.project.code].some(v => v.toLowerCase().includes(query))));
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "name") return a.project.name.localeCompare(b.project.name);
    if (sort === "budget") return Number(b.project.budget) - Number(a.project.budget);
    if (sort === "po") return b.estimatedOpenPoLines - a.estimatedOpenPoLines;
    const aShare = a.materialToBudgetPercent ?? -Infinity;
    const bShare = b.materialToBudgetPercent ?? -Infinity;
    return bShare - aShare || a.project.name.localeCompare(b.project.name);
  });
  const rows = sorted.slice(page * PAGE, (page + 1) * PAGE);
  const budget = filtered.reduce((s, x) => s + Math.max(0, Number(x.project.budget) || 0), 0);
  const materials = filtered.reduce((s, x) => s + x.netMaterialConsumed, 0);
  const openPos = filtered.reduce((s, x) => s + x.estimatedOpenPoLines, 0);
  const unpaid = filtered.reduce((s, x) => s + x.approvedUnpaidInvoices, 0);
  const capped = projectsQ.data?.capped || (canPo && posQ.data?.capped) ||
    (canInventory && consumptionQ.data?.possiblyCapped) || (canPayables && invoicesQ.data?.capped);

  const setFilter = (setter: (value: string) => void, value: string) => { setter(value); setPage(0); };
  const uniqueStatuses = [...new Set(projectRows.map(x => x.status))].sort();
  const missingSources = [
    !canPo && "purchase order commitments",
    !canInventory && "material usage",
    !canPayables && "approved invoices/payables",
  ].filter(Boolean);

  return <div className="pb-16">
    <PageHeader title="Project Cost Control"
      subtitle="Compare each construction project's approved budget with separately tracked material consumption, open purchase orders and supplier liabilities."
      actions={<Link to="/procurement/follow-ups" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-primary hover:underline">Supplier follow-ups <ArrowUpRight className="h-4 w-4" /></Link>} />

    <div className="mb-5 flex flex-wrap items-center gap-2">
      <div className="w-full sm:w-64"><SearchBox value={search} onChange={v => setFilter(setSearch, v)} placeholder="Search project name or code" /></div>
      <select aria-label="Project" className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-48 sm:flex-none")} value={projectId} onChange={e => setFilter(setProjectId, e.target.value)}>
        <option value="">All accessible projects</option>{projectRows.map(x => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
      </select>
      <select aria-label="Construction status" className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-44 sm:flex-none")} value={status} onChange={e => setFilter(setStatus, e.target.value)}>
        <option value="">All project statuses</option>{uniqueStatuses.map(x => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}
      </select>
      <select aria-label="Sort projects" className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-52 sm:flex-none")} value={sort} onChange={e => setFilter(setSort, e.target.value)}>
        <option value="material_share">Highest recorded material share</option>
        <option value="po">Largest open PO commitment</option>
        <option value="budget">Largest project budget</option>
        <option value="name">Project name (A–Z)</option>
      </select>
    </div>

    {partialError && <div role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      Some cost sources could not load; affected figures are intentionally hidden, not reported as zero.
      {posQ.error && <p>Purchase orders: {errMsg(posQ.error)}</p>}
      {consumptionQ.error && <p>Material consumption: {errMsg(consumptionQ.error)}</p>}
      {invoicesQ.error && <p>Vendor invoices: {errMsg(invoicesQ.error)}</p>}
    </div>}
    {!!missingSources.length && <div className="mb-4 rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
      Limited report access: {missingSources.join(", ")} unavailable to this role. A dash means unavailable, not zero.
    </div>}
    {capped && <div role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden />
      One or more data sources reached its API retrieval limit. Figures may be incomplete; do not use these totals for a financial decision without reconciliation.
    </div>}
    {qLoading ? <Loading /> : <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total project budgets" value={inr(budget)} hint={`${filtered.length} projects · lifetime baseline`} />
        <Stat label="Net materials consumed" value={canInventory && !consumptionQ.error ? inr(materials) : "—"} hint="Posted issue cost less return credits" />
        <Stat label="Open PO line commitments" value={canPo && !posQ.error ? inr(openPos) : "—"} hint="Undelivered material estimate¹" />
        <Stat label="Approved unpaid supplier bills" value={canPayables && !invoicesQ.error ? inr(unpaid) : "—"} hint="Actual approved AP balance²" />
      </div>

      {!filtered.length ? <Empty>No projects match these filters.</Empty> : <>
        <div className="grid gap-4 lg:hidden">
          {rows.map(row => <ProjectCostCard key={row.project.id} row={row}
            showPo={canPo && !posQ.error} showMaterials={canInventory && !consumptionQ.error}
            showPayables={canPayables && !invoicesQ.error} />)}
        </div>
        <div className="hidden overflow-x-auto rounded-xl border bg-card shadow-card lg:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground"><tr>
              <th scope="col" className="p-3">Project</th><th scope="col" className="p-3 text-right">Budget</th>
              <th scope="col" className="p-3 text-right">Estimated cost</th><th scope="col" className="p-3 text-right">Net material usage</th>
              <th scope="col" className="p-3">Material / budget</th><th scope="col" className="p-3 text-right">Open PO lines¹</th>
              <th scope="col" className="p-3 text-right">Approved unpaid bills²</th>
            </tr></thead>
            <tbody>{rows.map(row => <tr key={row.project.id} className="border-b last:border-0 hover:bg-muted/40">
              <td className="p-3"><div className="font-semibold">{row.project.name}</div><div className="text-xs text-muted-foreground">{row.project.code} · {row.project.status.replace(/_/g, " ")}</div></td>
              <td className="p-3 text-right tabular-nums">{Number(row.project.budget) > 0 ? inr(row.project.budget) : "Not set"}</td>
              <td className="p-3 text-right tabular-nums">{Number(row.project.estimated_cost) > 0 ? inr(row.project.estimated_cost) : "—"}</td>
              <td className="p-3 text-right font-semibold tabular-nums">{canInventory && !consumptionQ.error ? inr(row.netMaterialConsumed) : "—"}</td>
              <td className="min-w-36 p-3"><MaterialShare row={row} available={canInventory && !consumptionQ.error} /></td>
              <td className="p-3 text-right tabular-nums">{canPo && !posQ.error ? inr(row.estimatedOpenPoLines) : "—"}</td>
              <td className="p-3 text-right tabular-nums">{canPayables && !invoicesQ.error ? inr(row.approvedUnpaidInvoices) : "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <Pager page={page} total={sorted.length} size={PAGE} onPage={setPage} />
      </>}

      <section className="mt-7 rounded-xl border bg-card p-4 sm:p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><ChartNoAxesCombined className="h-4 w-4 text-primary" /> How to interpret this report</h3>
        <div className="mt-3 grid gap-4 text-sm text-muted-foreground md:grid-cols-2">
          <div className="flex items-start gap-2"><PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p><strong className="text-foreground">Recorded material consumption</strong> is posted store issues minus returns at issue-time cost. It does not cover subcontractors, labour, land, indirect expenses or materials purchased but not issued.</p></div>
          <div className="flex items-start gap-2"><ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p><strong className="text-foreground">Open PO commitment¹</strong> estimates ordered but not accepted and not short-closed materials. PO-level freight, discounts and extra charges are excluded. This is not a vendor payable.</p></div>
          <div className="flex items-start gap-2"><Wallet className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p><strong className="text-foreground">Approved unpaid bills²</strong> are the accounts-payable balance of approved or partly paid vendor invoices, not amounts spent in cash.</p></div>
          <div><p><strong className="text-foreground">Do not add these columns.</strong> A single purchase may appear as a PO, a material issue and an invoice. Material/budget % uses only recorded material consumption against the total project budget: it is <em>not</em> an all-cost budget utilisation or remaining-funds figure. All values are project-to-date, not filtered by financial year.</p></div>
        </div>
      </section>
    </>}
  </div>;
}

function MaterialShare({ row, available }: { row: CostProjectTotals; available: boolean }) {
  if (!available) return <span className="text-xs text-muted-foreground">Unavailable</span>;
  const pct = row.materialToBudgetPercent;
  if (pct === null) return <span className="text-xs text-muted-foreground">Budget not set</span>;
  return <div className="min-w-28">
    <div className="mb-1 flex justify-between gap-2 text-xs"><span className={cn("font-semibold tabular-nums", pct > 100 && "text-destructive")}>{pct.toLocaleString("en-IN")}%</span>{pct > 100 && <span className="text-destructive">Exceeds baseline</span>}</div>
    <Progress value={pct} />
  </div>;
}

function ProjectCostCard({ row, showPo, showMaterials, showPayables }: {
  row: CostProjectTotals; showPo: boolean; showMaterials: boolean; showPayables: boolean;
}) {
  return <article className="rounded-xl border bg-card p-4 shadow-card">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="text-base font-semibold">{row.project.name}</h3><p className="text-xs text-muted-foreground">{row.project.code} · {row.project.status.replace(/_/g, " ")}</p></div>
      <div className="text-right"><div className="text-xs text-muted-foreground">Project budget</div><div className="text-lg font-semibold tabular-nums">{Number(row.project.budget) > 0 ? inr(row.project.budget) : "Not set"}</div></div>
    </div>
    <div className="my-4"><MaterialShare row={row} available={showMaterials} /></div>
    <dl className="grid grid-cols-2 gap-4 border-t pt-3 text-sm">
      <div><dt className="text-xs text-muted-foreground">Estimated cost baseline</dt><dd className="mt-1 font-semibold tabular-nums">{Number(row.project.estimated_cost) > 0 ? inr(row.project.estimated_cost) : "—"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Net material usage</dt><dd className="mt-1 font-semibold tabular-nums">{showMaterials ? inr(row.netMaterialConsumed) : "—"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Open PO lines¹</dt><dd className="mt-1 font-semibold tabular-nums">{showPo ? inr(row.estimatedOpenPoLines) : "—"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Approved unpaid bills²</dt><dd className="mt-1 font-semibold tabular-nums">{showPayables ? inr(row.approvedUnpaidInvoices) : "—"}</dd></div>
    </dl>
    <div className="mt-4 flex flex-wrap gap-4 border-t pt-3 text-xs font-medium">
      {showMaterials && <Link to="/inventory/material-consumption" className="text-primary hover:underline">Material usage →</Link>}
      {showPo && <Link to="/procurement/follow-ups" className="text-primary hover:underline">Delivery follow-up →</Link>}
    </div>
  </article>;
}
