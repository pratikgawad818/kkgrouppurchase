import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowUpRight, BadgeIndianRupee, CalendarDays, Package, Store, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Empty, Loading, SearchBox, Stat } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { fmtDate, errMsg } from "@/lib/format";
import { today } from "@/lib/finance";
import { calendarDaysBetween } from "@/lib/procurement-followup";
import { AWARDED_PO_STATUSES, extractAwardedPoRates, summarizeSupplierRates, type MaterialRate } from "@/lib/supplier-rate-history";
import { useMe } from "@/lib/session";
import { selectCls, type PoStatus } from "@/lib/po";
import { cn } from "@/lib/utils";

const LIMIT = 3000;
const BATCH = 500;
const PAGE_SIZE = 8;
const PO_STATES: PoStatus[] = [...AWARDED_PO_STATUSES];
const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rate = (n: number) => currency.format(n);

export const Route = createFileRoute("/_authenticated/_shell/procurement/supplier-rate-history")({
  head: () => ({ meta: [{ title: "Supplier Rate History — KK GROUP ERP" }] }),
  component: SupplierRates,
});

function SupplierRates() {
  const me = useMe();
  const allowed = !!me.data?.permissions.has("purchase_order.view");
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");
  const [period, setPeriod] = useState("365");
  const [onlyComparable, setOnlyComparable] = useState(false);
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ["awarded-supplier-rate-history"],
    enabled: allowed,
    staleTime: 60_000,
    queryFn: async () => {
      const all: Awaited<ReturnType<typeof fetchBatch>>[] = [];
      for (let offset = 0; offset < LIMIT; offset += BATCH) {
        const batch = await fetchBatch(offset);
        all.push(batch);
        if (batch.length < BATCH) break;
      }
      return { rows: all.flat(), possiblyIncomplete: all.reduce((count, batch) => count + batch.length, 0) >= LIMIT };
    },
  });

  async function fetchBatch(offset: number) {
    const { data, error } = await supabase.from("purchase_orders")
      .select("id,po_number,po_date,status,project_id,vendor_id,projects(name),vendors(company_name),purchase_order_items(material_id,unit_id,rate,ordered_quantity,discount_amount,items(code,name),units_of_measure(code))")
      .in("status", PO_STATES).order("id")
      .range(offset, offset + BATCH - 1);
    if (error) throw error;
    return data ?? [];
  }

  if (me.isLoading || (allowed && q.isLoading)) return <Loading />;
  if (!allowed) return <>
    <PageHeader title="Supplier Rate History" />
    <Empty>Your account does not have permission to view purchase order rates.</Empty>
  </>;
  if (q.error) return <>
    <PageHeader title="Supplier Rate History" />
    <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Failed to load awarded purchase order rates: {errMsg(q.error)}</div>
  </>;

  const source = extractAwardedPoRates(q.data?.rows ?? []);
  const projectOptions = [...new Map(source.map(x => [x.projectId, { id: x.projectId, name: x.projectName }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const current = today();
  const days = period === "all" ? null : Number(period);
  const scoped = source.filter(x =>
    (!project || x.projectId === project) &&
    (days === null || (calendarDaysBetween(x.date, current) >= 0 && calendarDaysBetween(x.date, current) <= days)));
  const groups = summarizeSupplierRates(scoped);
  const term = search.trim().toLowerCase();
  const matching = groups.filter(x =>
    (!onlyComparable || x.vendors.length >= 2) &&
    (!term || [x.materialName, x.materialCode, x.unitCode].some(s => s.toLowerCase().includes(term))));
  const compared = groups.filter(x => x.vendors.length >= 2).length;
  const vendorCount = new Set(scoped.map(x => x.vendorId)).size;
  const pageRows = matching.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const change = (setter: (value: string) => void, value: string) => { setter(value); setPage(0); };

  return <div className="pb-16">
    <PageHeader title="Supplier Rate History"
      subtitle="Compare recorded, awarded purchase order unit rates for identical construction materials and units of measure—not live market quotes."
      actions={<Link to="/procurement/purchase-orders" className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline">Purchase Orders <ArrowUpRight className="h-4 w-4" /></Link>} />

    <div className="mb-5 flex flex-wrap items-center gap-2">
      <div className="w-full sm:w-72"><SearchBox value={search} onChange={x => change(setSearch, x)} placeholder="Find material or material code" /></div>
      <select aria-label="Project" className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-48 sm:flex-none")} value={project} onChange={e => change(setProject, e.target.value)}>
        <option value="">All accessible projects</option>
        {projectOptions.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <select aria-label="History period" className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-40 sm:flex-none")} value={period} onChange={e => change(setPeriod, e.target.value)}>
        <option value="90">Last 90 days</option><option value="365">Last 12 months</option>
        <option value="730">Last 24 months</option><option value="all">All recorded dates</option>
      </select>
      <label className="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 text-xs font-medium sm:min-h-9">
        <input aria-label="Only materials with at least two historical suppliers" type="checkbox" checked={onlyComparable}
          onChange={e => { setOnlyComparable(e.target.checked); setPage(0); }} className="h-4 w-4 accent-primary" />
        Two+ suppliers only
      </label>
    </div>

    {q.data?.possiblyIncomplete && <div role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <TriangleAlert className="mr-1 inline h-4 w-4" aria-hidden />
      At least {LIMIT.toLocaleString("en-IN")} awarded POs exist. This report shows only a recent dataset slice, so apparent lowest/highest rates may not represent full history. Use individual PO records before purchasing.
    </div>}

    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Materials with rates" value={groups.length} hint="Grouped by exact material and unit" />
      <Stat label="Comparable materials" value={compared} hint="At least two suppliers on record" />
      <Stat label="Suppliers represented" value={vendorCount} hint="In the chosen project/period" />
      <Stat label="Awarded PO lines" value={scoped.length} hint="Positive rate and ordered quantity" />
    </div>

    {!matching.length ? <Empty>No awarded PO rates match these filters. Check another period, material or project. At least one approved purchase order with a positive unit rate is required.</Empty> :
      <div className="space-y-4">
        {pageRows.map(material => <MaterialRateCard key={material.materialId + ":" + material.unitId} material={material} />)}
      </div>
    }
    <Pager page={page} total={matching.length} size={PAGE_SIZE} onPage={setPage} />

    <section className="mt-7 rounded-xl border bg-card p-4 sm:p-5">
      <h3 className="text-sm font-semibold">Purchasing interpretation</h3>
      <p className="mt-2 text-sm text-muted-foreground">Prices are historical <strong className="text-foreground">PO line base rates before discounts, GST and freight</strong>. Even when one supplier's last observed rate is lowest, it is <strong className="text-foreground">not a current quotation</strong> and does not guarantee today's price, quality, availability, quantity discounts, transport or credit terms. Compare only the same material ID and unit of measure; request a fresh RFQ before selecting a supplier.</p>
      <p className="mt-2 text-xs text-muted-foreground">Unapproved drafts, rejected/cancelled POs and zero-rate lines are excluded. Volume-weighted averages use ordered quantities, not accepted quantities or cash paid. All records are constrained by your existing purchase order access permissions and database RLS.</p>
    </section>
  </div>;
}

function MaterialRateCard({ material }: { material: MaterialRate }) {
  return <section className="overflow-hidden rounded-xl border bg-card shadow-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 p-4">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-base font-semibold"><Package className="h-4 w-4 shrink-0 text-primary" />{material.materialName}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{material.materialCode} · Per {material.unitCode || "unit"} · {material.sampleCount} awarded PO line{material.sampleCount === 1 ? "" : "s"}</p>
      </div>
      <div className="text-left sm:text-right">
        <div className="flex items-center gap-1 text-xs text-muted-foreground"><BadgeIndianRupee className="h-3.5 w-3.5" />Most recent recorded rates</div>
        <div className="mt-0.5 font-semibold tabular-nums">{rate(material.minLatestRate)}{material.vendors.length > 1 && `–${rate(material.maxLatestRate)}`}</div>
        <div className="text-xs text-muted-foreground">From {material.vendors.length} supplier{material.vendors.length === 1 ? "" : "s"}</div>
      </div>
    </div>
    <div className="divide-y">
      {material.vendors.map((vendor, index) => <div key={vendor.vendorId} className="grid gap-3 p-4 hover:bg-muted/20 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><Store className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">{vendor.vendorName}</span>
            {material.vendors.length > 1 && index === 0 && <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Lowest latest recorded</span>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground"><CalendarDays className="mr-1 inline h-3.5 w-3.5" />Latest PO {fmtDate(vendor.latest.date)} · {vendor.count} line{vendor.count === 1 ? "" : "s"} · {vendor.orderedQty.toLocaleString("en-IN")} {material.unitCode} ordered</p>
          <p className="mt-1 text-xs text-muted-foreground">Historical volume-weighted base rate: <strong className="text-foreground">{rate(vendor.weightedRate)}</strong> · Observed range: {rate(vendor.minRate)}–{rate(vendor.maxRate)}
            {vendor.anyDiscount && <span className="ml-1 font-medium text-amber-700">· Discounts existed on some lines</span>}
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 sm:block sm:text-right">
          <div className="text-lg font-semibold tabular-nums">{rate(vendor.latest.rate)}<span className="ml-1 text-xs font-normal text-muted-foreground">/{material.unitCode || "unit"}</span></div>
          <Link className="mt-1 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-primary hover:underline" to="/procurement/purchase-orders/$id" params={{ id: vendor.latest.poId }}>
            {vendor.latest.poNumber} <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>)}
    </div>
  </section>;
}
