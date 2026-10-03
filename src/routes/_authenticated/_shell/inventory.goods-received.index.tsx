import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Loading, PageHeader, SearchBox } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, fmtDate, inr, num } from "@/lib/format";
import { GRN_STATUS, selectCls } from "@/lib/po";
import { fyLabel, fyOf, fyOptions, PAGE } from "@/lib/fy";
import { cn } from "@/lib/utils";

const META = "Register of goods received against purchase orders.";
export const Route = createFileRoute("/_authenticated/_shell/inventory/goods-received/")({
  head: () => ({ meta: [{ title: "Goods Received — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Goods Received — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: GrnList,
});

function GrnList() {
  const [search, setSearch] = useState("");
  const [f, setF] = useState({ project: "", building: "", wh: "", vendor: "", fy: "", from: "", to: "" });
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ["grns"],
    queryFn: async () => {
      const { data, error } = await supabase.from("goods_receipt_notes")
        .select("id,grn_number,received_date,status,po_id,project_id,building_id,warehouse_id,vendor_id,purchase_orders(po_number),vendors(company_name),warehouses(name),projects(name),buildings(name),profiles!goods_receipt_notes_received_by_fkey(full_name),goods_receipt_items(accepted_quantity,unit_cost)")
        .order("created_at", { ascending: false }).limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const all = q.data ?? [];
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v, ...(k === "project" ? { building: "" } : {}) }); setPage(0); };
  const uniq = <T,>(arr: T[], key: (x: T) => string | null) => [...new Map(arr.filter((x) => key(x)).map((x) => [key(x)!, x])).values()];
  const s = search.trim().toLowerCase();
  const rows = all.filter((x) =>
    (!f.project || x.project_id === f.project) && (!f.building || x.building_id === f.building) && (!f.wh || x.warehouse_id === f.wh) &&
    (!f.vendor || x.vendor_id === f.vendor) && (!f.fy || fyOf(x.received_date) === Number(f.fy)) &&
    (!f.from || x.received_date >= f.from) && (!f.to || x.received_date <= f.to) &&
    (!s || [x.grn_number, x.purchase_orders?.po_number, x.vendors?.company_name].some((v) => v?.toLowerCase().includes(s))));
  const pageRows = rows.slice(page * PAGE, (page + 1) * PAGE);
  return (
    <>
      <PageHeader title="Goods Received" subtitle="Receipts are recorded from a purchase order using “Receive goods”." />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="w-60"><SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="GRN, PO, vendor" /></div>
        <select className={cn(selectCls, "w-44")} value={f.project} onChange={(e) => set("project", e.target.value)}><option value="">All projects</option>{uniq(all, (x) => x.project_id).map((x) => <option key={x.project_id} value={x.project_id}>{x.projects?.name}</option>)}</select>
        <select className={cn(selectCls, "w-40")} value={f.building} onChange={(e) => set("building", e.target.value)}><option value="">All buildings</option>{uniq(all.filter((x) => !f.project || x.project_id === f.project), (x) => x.building_id).map((x) => <option key={x.building_id!} value={x.building_id!}>{x.buildings?.name}</option>)}</select>
        <select className={cn(selectCls, "w-40")} value={f.wh} onChange={(e) => set("wh", e.target.value)}><option value="">All stores</option>{uniq(all, (x) => x.warehouse_id).map((x) => <option key={x.warehouse_id} value={x.warehouse_id}>{x.warehouses?.name}</option>)}</select>
        <select className={cn(selectCls, "w-44")} value={f.vendor} onChange={(e) => set("vendor", e.target.value)}><option value="">All vendors</option>{uniq(all, (x) => x.vendor_id).map((x) => <option key={x.vendor_id} value={x.vendor_id}>{x.vendors?.company_name}</option>)}</select>
        <select className={cn(selectCls, "w-36")} value={f.fy} onChange={(e) => set("fy", e.target.value)}><option value="">All years</option>{fyOptions(all.map((x) => x.received_date)).map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select>
        <Input type="date" className="h-9 w-40" value={f.from} onChange={(e) => set("from", e.target.value)} aria-label="From date" />
        <Input type="date" className="h-9 w-40" value={f.to} onChange={(e) => set("to", e.target.value)} aria-label="To date" />
      </div>
      {q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : (<>
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="p-2">GRN</th><th className="p-2">Date</th><th className="p-2">PO</th><th className="p-2">Vendor</th><th className="p-2">Project</th><th className="p-2">Building</th><th className="p-2">Store</th><th className="p-2 text-right">Accepted qty</th><th className="p-2 text-right">Accepted value</th><th className="p-2">By</th><th className="p-2">Status</th></tr></thead>
            <tbody>
              {pageRows.length === 0 && <tr><td colSpan={11} className="p-4 text-xs text-muted-foreground">No goods received match.</td></tr>}
              {pageRows.map((x) => {
                const qty = x.goods_receipt_items.reduce((a, i) => a + Number(i.accepted_quantity), 0);
                const value = x.goods_receipt_items.reduce((a, i) => a + Number(i.accepted_quantity) * Number(i.unit_cost), 0);
                return (
                <tr key={x.id} className="border-b last:border-0">
                  <td className="p-2 font-mono"><Link className="text-primary hover:underline" to="/inventory/goods-received/$id" params={{ id: x.id }}>{x.grn_number}</Link></td>
                  <td className="p-2">{fmtDate(x.received_date)}</td>
                  <td className="p-2 font-mono text-xs"><Link className="hover:underline" to="/procurement/purchase-orders/$id" params={{ id: x.po_id }}>{x.purchase_orders?.po_number}</Link></td>
                  <td className="p-2">{x.vendors?.company_name}</td><td className="p-2">{x.projects?.name}</td><td className="p-2">{x.buildings?.name ?? "—"}</td><td className="p-2">{x.warehouses?.name}</td>
                  <td className="p-2 text-right font-mono">{num(qty)}</td><td className="p-2 text-right font-mono">{inr(value)}</td>
                  <td className="p-2 text-xs">{x.profiles?.full_name ?? "—"}</td>
                  <td className="p-2"><span className={cn("rounded-sm border px-1.5 py-0.5 text-[11px]", GRN_STATUS[x.status].cls)}>{GRN_STATUS[x.status].label}</span></td>
                </tr>); })}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={rows.length} size={PAGE} onPage={setPage} />
      </>)}
    </>
  );
}
