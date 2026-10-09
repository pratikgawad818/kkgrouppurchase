import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Loading, PageHeader, SearchBox } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, fmtDate, inr } from "@/lib/format";
import { PO_STATUS, selectCls, type PoStatus } from "@/lib/po";
import { purchaseOrderLineValues } from "@/lib/procurement-followup";
import { fyLabel, fyOf, fyOptions, PAGE } from "@/lib/fy";
import { cn } from "@/lib/utils";

const META = "Purchase orders raised from awarded vendor quotations.";
export const Route = createFileRoute("/_authenticated/_shell/procurement/purchase-orders/")({
  head: () => ({ meta: [{ title: "Purchase Orders — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Purchase Orders — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: PoList,
});

function PoList() {
  const [search, setSearch] = useState("");
  const [f, setF] = useState({ status: "" as "" | PoStatus, vendor: "", project: "", building: "", fy: "", from: "", to: "" });
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ["pos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_orders")
        .select("id,po_number,po_date,grand_total,status,vendor_id,project_id,building_id,vendors(company_name),projects(name),buildings(name),rfqs(rfq_number),purchase_order_items(ordered_quantity,accepted_quantity,short_closed_quantity,line_total,items(name))")
        .order("created_at", { ascending: false }).limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const all = q.data ?? [];
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v, ...(k === "project" ? { building: "" } : {}) }); setPage(0); };
  const uniq = <T,>(arr: T[], key: (x: T) => string) => [...new Map(arr.map((x) => [key(x), x])).values()];
  const vendors = uniq(all.filter((x) => x.vendors), (x) => x.vendor_id);
  const projects = uniq(all.filter((x) => x.projects), (x) => x.project_id);
  const buildings = uniq(all.filter((x) => x.building_id && (!f.project || x.project_id === f.project)), (x) => x.building_id!);
  const s = search.trim().toLowerCase();
  const val = (x: (typeof all)[number]) => purchaseOrderLineValues(x.purchase_order_items);
  const rows = all.filter((x) =>
    (!f.status || x.status === f.status) && (!f.vendor || x.vendor_id === f.vendor) && (!f.project || x.project_id === f.project) &&
    (!f.building || x.building_id === f.building) && (!f.fy || fyOf(x.po_date) === Number(f.fy)) &&
    (!f.from || x.po_date >= f.from) && (!f.to || x.po_date <= f.to) &&
    (!s || [x.po_number, x.vendors?.company_name, x.projects?.name, x.rfqs?.rfq_number, ...x.purchase_order_items.map((i) => i.items?.name)].some((v) => v?.toLowerCase().includes(s))));
  const pageRows = rows.slice(page * PAGE, (page + 1) * PAGE);
  return (
    <>
      <PageHeader title="Purchase Orders" subtitle="Create POs from an RFQ that is Ready for Purchase Order."
        actions={<div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link to="/procurement/follow-ups">Supplier follow-ups</Link></Button><Button asChild size="sm" variant="outline"><Link to="/procurement/supplier-rate-history">Supplier prices</Link></Button></div>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="w-full sm:w-64"><SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="PO, vendor, material, project, RFQ" /></div>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-44 sm:flex-none")} value={f.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">All statuses</option>{Object.entries(PO_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-44 sm:flex-none")} value={f.vendor} onChange={(e) => set("vendor", e.target.value)}><option value="">All vendors</option>{vendors.map((x) => <option key={x.vendor_id} value={x.vendor_id}>{x.vendors?.company_name}</option>)}</select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-44 sm:flex-none")} value={f.project} onChange={(e) => set("project", e.target.value)}><option value="">All projects</option>{projects.map((x) => <option key={x.project_id} value={x.project_id}>{x.projects?.name}</option>)}</select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-40 sm:flex-none")} value={f.building} onChange={(e) => set("building", e.target.value)}><option value="">All buildings</option>{buildings.map((x) => <option key={x.building_id!} value={x.building_id!}>{x.buildings?.name}</option>)}</select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-36 sm:flex-none")} value={f.fy} onChange={(e) => set("fy", e.target.value)}><option value="">All years</option>{fyOptions(all.map((x) => x.po_date)).map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select>
        <Input type="date" className="h-11 min-w-0 flex-1 sm:h-9 sm:w-40 sm:flex-none" value={f.from} onChange={(e) => set("from", e.target.value)} aria-label="From date" />
        <Input type="date" className="h-11 min-w-0 flex-1 sm:h-9 sm:w-40 sm:flex-none" value={f.to} onChange={(e) => set("to", e.target.value)} aria-label="To date" />
      </div>
      {q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : (<>
        <div className="doc-table overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">PO</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Building</th><th className="px-4 py-3">RFQ</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Accepted¹</th><th className="px-4 py-3 text-right">Open lines¹</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody>
              {pageRows.length === 0 && <tr><td colSpan={10} className="p-4 text-xs text-muted-foreground">No purchase orders match.</td></tr>}
              {pageRows.map((x) => { const v = val(x); return (
                <tr key={x.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium tabular-nums"><Link className="text-primary hover:underline" to="/procurement/purchase-orders/$id" params={{ id: x.id }}>{x.po_number}</Link></td>
                  <td className="px-4 py-3">{fmtDate(x.po_date)}</td>
                  <td className="px-4 py-3">{x.vendors?.company_name}</td><td className="px-4 py-3">{x.projects?.name}</td><td className="px-4 py-3">{x.buildings?.name ?? "—"}</td>
                  <td className="px-4 py-3 font-medium tabular-nums text-xs">{x.rfqs?.rfq_number}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{inr(x.grand_total)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{inr(v.acceptedLineValue)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{x.status === "cancelled" || x.status === "closed" ? "—" : inr(v.estimatedOpenLineValue)}</td>
                  <td className="px-4 py-3"><span className={cn("whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", PO_STATUS[x.status].cls)}>{PO_STATUS[x.status].label}</span></td>
                </tr>); })}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={rows.length} size={PAGE} onPage={setPage} />
        <p className="mt-2 text-xs text-muted-foreground">¹ Estimated material line value based on <strong>accepted</strong> quantities and remaining commitment after short-closing. Excludes PO-level freight, other charges and discounts; this is not an account payable or vendor balance.</p>
      </>)}
    </>
  );
}
