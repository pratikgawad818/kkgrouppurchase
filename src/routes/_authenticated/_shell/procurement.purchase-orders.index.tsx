import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Loading, PageHeader, SearchBox } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, fmtDate, inr } from "@/lib/format";
import { PO_STATUS, selectCls, type PoStatus } from "@/lib/po";
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
        .select("id,po_number,po_date,grand_total,status,vendor_id,project_id,building_id,vendors(company_name),projects(name),buildings(name),rfqs(rfq_number),purchase_order_items(ordered_quantity,received_quantity,line_total,items(name))")
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
  const val = (x: (typeof all)[number]) => {
    let rec = 0;
    for (const i of x.purchase_order_items) rec += Number(i.ordered_quantity) ? (Number(i.line_total) * Number(i.received_quantity)) / Number(i.ordered_quantity) : 0;
    return { rec, pend: Math.max(0, Number(x.grand_total) - rec) };
  };
  const rows = all.filter((x) =>
    (!f.status || x.status === f.status) && (!f.vendor || x.vendor_id === f.vendor) && (!f.project || x.project_id === f.project) &&
    (!f.building || x.building_id === f.building) && (!f.fy || fyOf(x.po_date) === Number(f.fy)) &&
    (!f.from || x.po_date >= f.from) && (!f.to || x.po_date <= f.to) &&
    (!s || [x.po_number, x.vendors?.company_name, x.projects?.name, x.rfqs?.rfq_number, ...x.purchase_order_items.map((i) => i.items?.name)].some((v) => v?.toLowerCase().includes(s))));
  const pageRows = rows.slice(page * PAGE, (page + 1) * PAGE);
  return (
    <>
      <PageHeader title="Purchase Orders" subtitle="Create POs from an RFQ that is Ready for Purchase Order." />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="w-64"><SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="PO, vendor, material, project, RFQ" /></div>
        <select className={cn(selectCls, "w-44")} value={f.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">All statuses</option>{Object.entries(PO_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className={cn(selectCls, "w-44")} value={f.vendor} onChange={(e) => set("vendor", e.target.value)}><option value="">All vendors</option>{vendors.map((x) => <option key={x.vendor_id} value={x.vendor_id}>{x.vendors?.company_name}</option>)}</select>
        <select className={cn(selectCls, "w-44")} value={f.project} onChange={(e) => set("project", e.target.value)}><option value="">All projects</option>{projects.map((x) => <option key={x.project_id} value={x.project_id}>{x.projects?.name}</option>)}</select>
        <select className={cn(selectCls, "w-40")} value={f.building} onChange={(e) => set("building", e.target.value)}><option value="">All buildings</option>{buildings.map((x) => <option key={x.building_id!} value={x.building_id!}>{x.buildings?.name}</option>)}</select>
        <select className={cn(selectCls, "w-36")} value={f.fy} onChange={(e) => set("fy", e.target.value)}><option value="">All years</option>{fyOptions(all.map((x) => x.po_date)).map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select>
        <Input type="date" className="h-9 w-40" value={f.from} onChange={(e) => set("from", e.target.value)} aria-label="From date" />
        <Input type="date" className="h-9 w-40" value={f.to} onChange={(e) => set("to", e.target.value)} aria-label="To date" />
      </div>
      {q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : (<>
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="p-2">PO</th><th className="p-2">Date</th><th className="p-2">Vendor</th><th className="p-2">Project</th><th className="p-2">Building</th><th className="p-2">RFQ</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Received</th><th className="p-2 text-right">Pending</th><th className="p-2">Status</th></tr></thead>
            <tbody>
              {pageRows.length === 0 && <tr><td colSpan={10} className="p-4 text-xs text-muted-foreground">No purchase orders match.</td></tr>}
              {pageRows.map((x) => { const v = val(x); return (
                <tr key={x.id} className="border-b last:border-0">
                  <td className="p-2 font-mono"><Link className="text-primary hover:underline" to="/procurement/purchase-orders/$id" params={{ id: x.id }}>{x.po_number}</Link></td>
                  <td className="p-2">{fmtDate(x.po_date)}</td>
                  <td className="p-2">{x.vendors?.company_name}</td><td className="p-2">{x.projects?.name}</td><td className="p-2">{x.buildings?.name ?? "—"}</td>
                  <td className="p-2 font-mono text-xs">{x.rfqs?.rfq_number}</td>
                  <td className="p-2 text-right font-mono">{inr(x.grand_total)}</td>
                  <td className="p-2 text-right font-mono">{inr(v.rec)}</td>
                  <td className="p-2 text-right font-mono">{x.status === "cancelled" || x.status === "closed" ? "—" : inr(v.pend)}</td>
                  <td className="p-2"><span className={cn("rounded-sm border px-1.5 py-0.5 text-[11px]", PO_STATUS[x.status].cls)}>{PO_STATUS[x.status].label}</span></td>
                </tr>); })}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={rows.length} size={PAGE} onPage={setPage} />
      </>)}
    </>
  );
}
