import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, ArrowUpRight, ClipboardList, PackageX, ShoppingCart, Truck, Warehouse } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Empty, Loading, PageHeader, SearchBox, Stat } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { fmtDate, num, errMsg } from "@/lib/format";
import { useMe } from "@/lib/session";
import { today } from "@/lib/finance";
import { selectCls, type PoStatus } from "@/lib/po";
import { PAGE } from "@/lib/fy";
import { cn } from "@/lib/utils";
import {
  planReorders,
  type PlanningMaterial,
  type PlanningStore,
  type ReorderLine,
  type ReorderState,
} from "@/lib/reorder-planning";
import { ACTIVE_DELIVERY_PO_STATUSES } from "@/lib/procurement-followup";

const BATCH = 400;
const MAX_ROWS = 3200;
const ACTIVE_POS: PoStatus[] = [...ACTIVE_DELIVERY_PO_STATUSES];
const priority: Record<ReorderState, { label: string; color: string }> = {
  out_of_stock: { label: "Out of stock", color: "border-destructive/30 bg-destructive/10 text-destructive" },
  order_review: { label: "Reorder review", color: "border-amber-300 bg-amber-50 text-amber-900" },
  await_inbound: { label: "Incoming may cover", color: "border-blue-200 bg-blue-50 text-blue-800" },
};

/**
 * PostgREST normally defaults to a 1,000-row response. Fetch bounded,
 * consistently ordered batches and warn when the cap may be reached.
 */
async function loadPages<T>(fn: (offset: number) => Promise<T[]>): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += BATCH) {
    const batch = await fn(offset);
    rows.push(...batch);
    if (batch.length < BATCH) return { rows, capped: false };
  }
  return { rows, capped: true };
}

export const Route = createFileRoute("/_authenticated/_shell/inventory/reorder-planning")({
  head: () => ({ meta: [{ title: "Low Stock & Reorder Planning — KK GROUP ERP" }] }),
  component: ReorderPlanning,
});

function ReorderPlanning() {
  const me = useMe();
  const permissions = me.data?.permissions;
  const canStock = !!permissions?.has("inventory.view");
  const canMaterials = !!permissions?.has("materials.view");
  const canPO = !!permissions?.has("purchase_order.view");
  const canCreatePR = !!permissions?.has("purchase_request.create");

  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [state, setState] = useState<ReorderState | "all">("all");
  const [page, setPage] = useState(0);

  const stockQ = useQuery({
    queryKey: ["reorder-planning", "warehouse-stock"],
    enabled: canStock,
    staleTime: 60_000,
    queryFn: () => loadPages(async offset => {
      const { data, error } = await supabase.from("warehouse_stock")
        .select("warehouse_id,material_id,quantity_on_hand,items(id,code,name,status,minimum_stock,reorder_level,maximum_stock,units_of_measure(code)),warehouses(id,code,name,status,project_id,projects(name))")
        .order("warehouse_id").order("material_id")
        .range(offset, offset + BATCH - 1);
      if (error) throw error;
      return data ?? [];
    }),
  });

  const storesQ = useQuery({
    queryKey: ["reorder-planning", "warehouses"],
    enabled: canStock,
    staleTime: 60_000,
    queryFn: () => loadPages(async offset => {
      const { data, error } = await supabase.from("warehouses")
        .select("id,code,name,status,project_id,projects(name)")
        .eq("status", "active").order("id")
        .range(offset, offset + BATCH - 1);
      if (error) throw error;
      return data ?? [];
    }),
  });

  const materialsQ = useQuery({
    queryKey: ["reorder-planning", "materials"],
    enabled: canStock && canMaterials,
    staleTime: 60_000,
    queryFn: () => loadPages(async offset => {
      const { data, error } = await supabase.from("items")
        .select("id,code,name,status,minimum_stock,reorder_level,maximum_stock,units_of_measure(code)")
        .eq("status", "active").order("id")
        .range(offset, offset + BATCH - 1);
      if (error) throw error;
      return data ?? [];
    }),
  });

  const posQ = useQuery({
    queryKey: ["reorder-planning", "open-pos"],
    enabled: canStock && canPO,
    staleTime: 60_000,
    queryFn: () => loadPages(async offset => {
      const { data, error } = await supabase.from("purchase_orders")
        .select("id,po_number,status,delivery_warehouse_id,expected_delivery_date,purchase_order_items(material_id,ordered_quantity,accepted_quantity,short_closed_quantity)")
        .in("status", ACTIVE_POS).order("id")
        .range(offset, offset + BATCH - 1);
      if (error) throw error;
      return data ?? [];
    }),
  });

  if (me.isLoading || (canStock && stockQ.isLoading)) return <Loading />;
  if (!canStock) return <>
    <PageHeader title="Low Stock & Reorder Planning" />
    <Empty>Your account does not have permission to view warehouse stock.</Empty>
  </>;
  if (stockQ.error) return <>
    <PageHeader title="Low Stock & Reorder Planning" />
    <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      Cannot load current warehouse balances: {errMsg(stockQ.error)}
    </div>
  </>;

  const stockRows = stockQ.data?.rows ?? [];
  // Embedded item/store metadata remains useful for store operators without
  // master-data browsing permissions. Their RLS-visible stock is all we use.
  const derivedMaterials = new Map<string, PlanningMaterial>();
  const derivedStores = new Map<string, PlanningStore>();
  for (const row of stockRows) {
    if (row.items) derivedMaterials.set(row.material_id, row.items);
    if (row.warehouses) derivedStores.set(row.warehouse_id, row.warehouses);
  }
  const materialList = [...new Map([
    ...derivedMaterials.entries(),
    ...(materialsQ.data?.rows ?? []).map(m => [m.id, m] as const),
  ]).values()];
  const storeList = [...new Map([
    ...derivedStores.entries(),
    ...(storesQ.data?.rows ?? []).map(w => [w.id, w] as const),
  ]).values()];
  const canTrustPos = canPO && !posQ.isLoading && !posQ.error && !posQ.data?.capped;
  // If we cannot see ALL open POs, do not offer speculative purchase quantities.
  const result = planReorders(materialList, storeList,
    stockRows.map(x => ({ warehouse_id: x.warehouse_id, material_id: x.material_id, quantity_on_hand: x.quantity_on_hand })),
    canTrustPos ? posQ.data!.rows : null,
    today());

  const projects = [...new Map(storeList.filter(w => w.project_id).map(w => [
    w.project_id!, { id: w.project_id!, name: w.projects?.name ?? w.code },
  ])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const warehouses = storeList.filter(w => w.status === "active" && (!project || (project === "company" ? !w.project_id : w.project_id === project)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const term = search.trim().toLowerCase();
  const scoped = result.lines.filter(x =>
    (!project || (project === "company" ? !x.store.project_id : x.store.project_id === project)) &&
    (!warehouse || x.store.id === warehouse) &&
    (!term || [x.material.name, x.material.code, x.store.name, x.store.code].some(s => s.toLowerCase().includes(term))));
  const filtered = scoped.filter(x => state === "all" || x.state === state);
  const pageRows = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const counts = {
    out: scoped.filter(x => x.state === "out_of_stock").length,
    reorder: scoped.filter(x => x.state === "order_review").length,
    inbound: scoped.filter(x => x.state === "await_inbound").length,
    overdue: scoped.filter(x => x.hasOverdueInbound).length,
  };
  const sourcesBusy = (canPO && posQ.isLoading) || storesQ.isLoading || (canMaterials && materialsQ.isLoading);
  const capped = stockQ.data?.capped || storesQ.data?.capped || (canMaterials && materialsQ.data?.capped) || (canPO && posQ.data?.capped);

  const change = (setter: (value: string) => void, value: string) => { setter(value); setPage(0); };
  const changeState = (next: ReorderState | "all") => { setState(next); setPage(0); };

  return <div className="pb-16">
    <PageHeader title="Low Stock & Reorder Planning"
      subtitle="Review site-wise stock thresholds alongside unreceived, approved PO quantities—without creating duplicate purchase orders."
      actions={<div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm"><Link to="/inventory/stock">Stock register <ArrowUpRight className="ml-1 h-4 w-4" /></Link></Button>
        {canCreatePR && <Button asChild size="sm"><Link to="/procurement/purchase-requests/new">Create purchase request</Link></Button>}
      </div>} />

    <div className="mb-4 flex flex-wrap gap-2">
      <div className="w-full sm:w-64"><SearchBox placeholder="Find material or store" value={search} onChange={v => change(setSearch, v)} /></div>
      <select aria-label="Project or site" className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-48 sm:flex-none")}
        value={project} onChange={e => { setProject(e.target.value); setWarehouse(""); setPage(0); }}>
        <option value="">All accessible projects</option>
        <option value="company">Company-wide stores</option>
        {projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <select aria-label="Store" className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-44 sm:flex-none")}
        value={warehouse} onChange={e => change(setWarehouse, e.target.value)}>
        <option value="">All relevant stores</option>
        {warehouses.map(x => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
      </select>
      <select aria-label="Urgency" className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-44 sm:flex-none")}
        value={state} onChange={e => changeState(e.target.value as ReorderState | "all")}>
        <option value="all">All attention lines</option>
        <option value="out_of_stock">Out of stock</option>
        <option value="order_review">Needs reorder review</option>
        <option value="await_inbound">Incoming may cover</option>
      </select>
    </div>

    {!canPO && <div role="status" className="mb-4 rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
      You can see stock, but not purchase orders. Inbound quantities and safe reorder quantities cannot be determined. Ask an authorised purchasing user to review open POs.
    </div>}
    {(posQ.error || storesQ.error || materialsQ.error) && <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      Some planning sources were unavailable. Do not assume missing data means zero.
      {posQ.error && <div>Open POs: {errMsg(posQ.error)}</div>}
      {storesQ.error && <div>Store directory: {errMsg(storesQ.error)}</div>}
      {materialsQ.error && <div>Material directory: {errMsg(materialsQ.error)}</div>}
    </div>}
    {capped && <div role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />
      A source reached the {MAX_ROWS.toLocaleString("en-IN")}-record review limit. Totals may be incomplete; confirm pending POs and warehouse stock before raising new requests.
    </div>}

    {sourcesBusy && <Loading />}
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <button type="button" className="text-left" onClick={() => changeState("out_of_stock")}><Stat label="Out of stock" value={counts.out} hint="No available stock at that store" className="hover:border-destructive/40" /></button>
      <button type="button" className="text-left" onClick={() => changeState("order_review")}><Stat label="Reorder review" value={counts.reorder} hint="Known incoming remains insufficient" className="hover:border-amber-400" /></button>
      <button type="button" className="text-left" onClick={() => changeState("await_inbound")}><Stat label="Incoming may cover" value={counts.inbound} hint="Confirm dispatch & goods receipt" className="hover:border-primary/40" /></button>
      <Stat label="Past-due PO deliveries" value={canTrustPos ? counts.overdue : "—"} hint="Linked to monitored stock lines" />
    </div>

    {!filtered.length && !sourcesBusy ? <Empty>No configured low-stock lines match these filters. Materials without a store record are reviewed separately below.</Empty> :
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {pageRows.map(row => <ReorderCard key={row.key} line={row} canPO={canPO} poDataReady={canTrustPos} />)}
      </div>}
    <Pager page={page} total={filtered.length} size={PAGE} onPage={setPage} />

    {(result.unallocated.length > 0 || result.notAssignedToStore.length > 0 || result.unconfiguredStockLines > 0) && <section className="mt-7 rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" /> Configuration & allocation checks</h2>
      {canTrustPos && result.unallocated.length > 0 && <div className="mt-3">
        <h3 className="text-sm font-semibold">PO material with no accessible delivery store</h3>
        <p className="mb-2 text-xs text-muted-foreground">These quantities are <strong>not</strong> credited to any site's incoming stock. Confirm and set the PO destination through the authorised workflow.</p>
        <ul className="grid gap-2 sm:grid-cols-2">{result.unallocated.slice(0, 25).map(x => <li key={x.material.id} className="rounded-lg border p-3 text-sm"><strong>{x.material.name}</strong><div className="mt-1 text-xs text-muted-foreground">{num(x.qty)} {x.material.units_of_measure?.code} · {x.purchaseOrders} PO(s) without an accessible destination</div></li>)}</ul>
        {result.unallocated.length > 25 && <p className="mt-2 text-xs text-muted-foreground">Showing first 25 of {result.unallocated.length}. Review open purchase orders for additional destinations.</p>}
      </div>}
      {canMaterials && !materialsQ.error && !materialsQ.data?.capped && !stockQ.data?.capped && result.notAssignedToStore.length > 0 && <div className="mt-4">
        <h3 className="text-sm font-semibold">Configured materials without a visible store record</h3>
        <p className="mb-2 text-xs text-muted-foreground">Not assigned to any warehouse by this report; this is not proof that every store is out of stock. Confirm intended site allocation first.</p>
        <p className="text-sm">{result.notAssignedToStore.slice(0, 18).map(x => x.name).join(" · ")}{result.notAssignedToStore.length > 18 && ` · +${result.notAssignedToStore.length - 18} more`}</p>
      </div>}
      {result.unconfiguredStockLines > 0 && <p className="mt-3 text-xs text-muted-foreground">{result.unconfiguredStockLines} stock line(s) do not have an actionable minimum/reorder/maximum level. Configure thresholds in the <Link to="/materials" className="font-medium text-primary hover:underline">Materials register</Link> before expecting alerts.</p>}
    </section>}

    <section className="mt-6 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
      <h3 className="font-semibold text-foreground">How reorder planning works</h3>
      <p className="mt-2">A store is flagged when on-hand stock is at or below the greater of its material's minimum stock and reorder level. This ERP currently uses <strong>material-wide thresholds</strong>, not separate targets per warehouse. A purchase order is counted as potential incoming stock only when it is approved/sent/partially received, has a visible warehouse destination and still has quantities unaccepted and not short-closed.</p>
      <p className="mt-2"><strong>Incoming is a commitment, not inventory.</strong> “Projected” stock assumes the open PO arrives and passes inspection. Overdue, undated or delayed deliveries may still leave a site without usable stock. Suggested top-up quantities are provided only when a valid maximum-stock target and a complete visible PO queue exist; they are review aids, <em>not</em> approved purchase requisitions.</p>
      <p className="mt-2">Materials with no recorded stock and no assigned inbound PO are never arbitrarily assigned to all sites. Before creating a purchase request, review open PRs, other warehouses and pending orders to avoid duplicate buying.</p>
    </section>
  </div>;
}

function ReorderCard({ line, canPO, poDataReady }: { line: ReorderLine; canPO: boolean; poDataReady: boolean }) {
  const p = priority[line.state];
  const hasIncoming = poDataReady && line.incoming > 0;
  return <article className="min-w-0 overflow-hidden rounded-xl border bg-card p-4 shadow-card">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h3 className="font-semibold">{line.material.name}</h3>
        <p className="text-xs text-muted-foreground">{line.material.code} · {line.material.units_of_measure?.code || "unit"}</p></div>
      <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold", p.color)}>{p.label}</span>
    </div>
    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Warehouse className="h-3.5 w-3.5" aria-hidden />{line.store.name} ({line.store.code}){line.store.projects?.name ? ` · ${line.store.projects.name}` : ""}</div>
    <dl className="mt-4 grid grid-cols-2 gap-3 border-y py-3 text-sm">
      <div><dt className="text-xs text-muted-foreground">On hand</dt><dd className={cn("mt-1 font-semibold tabular-nums", line.onHand <= 0 && "text-destructive")}>{num(line.onHand)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Reorder point</dt><dd className="mt-1 font-semibold tabular-nums">{num(line.reorderPoint)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Open PO incoming¹</dt><dd className="mt-1 font-semibold tabular-nums">{poDataReady ? num(line.incoming) : "—"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">If incoming arrives¹</dt><dd className="mt-1 font-semibold tabular-nums">{poDataReady ? num(line.projectedIfDelivered) : "—"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Max-stock target</dt><dd className="mt-1 font-semibold tabular-nums">{line.target === null ? "Not set" : num(line.target)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Top-up to target²</dt><dd className="mt-1 font-semibold tabular-nums">{line.suggestedTopUp === null ? "Review needed" : num(line.suggestedTopUp)}</dd></div>
    </dl>
    {line.state === "await_inbound" && <p className="mt-3 rounded-md bg-blue-50 p-2 text-xs text-blue-900">Recorded open POs could lift stock above the reorder point; confirm supplier delivery before raising another request.</p>}
    {line.hasOverdueInbound && <p className="mt-3 text-xs font-medium text-destructive"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />At least one linked PO delivery is past due.</p>}
    {line.hasUndatedInbound && <p className="mt-2 text-xs font-medium text-amber-800">Some inbound purchase orders have no delivery date.</p>}
    {line.unassignedIncoming > 0 && <p className="mt-2 text-xs text-amber-800">Another {num(line.unassignedIncoming)} {line.material.units_of_measure?.code} is on POs without a visible store destination; not counted here.</p>}
    {hasIncoming && <div className="mt-3 space-y-1.5">
      <p className="text-xs font-semibold text-foreground"><Truck className="mr-1 inline h-3.5 w-3.5" aria-hidden />Open incoming orders</p>
      {line.incomingOrders.slice(0, 3).map((po, index) => <div key={po.id + ":" + index} className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <Link to="/procurement/purchase-orders/$id" params={{ id: po.id }} className="font-medium text-primary hover:underline">{po.number} <ArrowUpRight className="inline h-3 w-3" /></Link>
        <span className="text-muted-foreground">{num(po.qty)} · {po.expectedDate ? fmtDate(po.expectedDate) : "Date not set"}</span>
      </div>)}
      {line.incomingOrders.length > 3 && <p className="text-xs text-muted-foreground">+{line.incomingOrders.length - 3} more open lines</p>}
    </div>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
      <span>{line.state === "out_of_stock" ? <><PackageX className="mr-1 inline h-3.5 w-3.5" />Urgent: confirm on-site demand</> : "Check site requirements before buying"}</span>
      {canPO && <Link to="/procurement/follow-ups" className="inline-flex min-h-9 items-center gap-1 font-semibold text-primary hover:underline"><ShoppingCart className="h-3.5 w-3.5" />PO follow-ups</Link>}
    </div>
  </article>;
}
