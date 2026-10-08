import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Loading, PageHeader, SearchBox } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, fmtDateTime, inr, num } from "@/lib/format";
import { selectCls, TX_LABEL, type InvTxType } from "@/lib/po";
import { PAGE } from "@/lib/fy";
import { cn } from "@/lib/utils";

const META = "Permanent stock ledger of every material movement.";
export const Route = createFileRoute("/_authenticated/_shell/inventory/stock-movements")({
  head: () => ({ meta: [{ title: "Stock Movements — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Stock Movements — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Ledger,
});

function Ledger() {
  const [search, setSearch] = useState("");
  const [f, setF] = useState({ wh: "", project: "", building: "", type: "", from: "", to: "" });
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ["stock-ledger"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_transactions")
        .select("id,created_at,tx_date,tx_type,quantity_in,quantity_out,unit_cost,total_cost,balance_after,grn_id,warehouse_id,project_id,building_id,remarks,items(code,name,units_of_measure(code)),warehouses(name),projects(name),buildings(name),goods_receipt_notes(grn_number),stock_transfers(transfer_number),stock_adjustments(adjustment_number),profiles(full_name)")
        .order("id", { ascending: false }).limit(3000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const all = q.data ?? [];
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(0); };
  const uniq = <T,>(arr: T[], key: (x: T) => string | null) => [...new Map(arr.filter((x) => key(x)).map((x) => [key(x)!, x])).values()];
  const s = search.trim().toLowerCase();
  const rows = all.filter((x) => (!f.wh || x.warehouse_id === f.wh) && (!f.project || x.project_id === f.project) && (!f.building || x.building_id === f.building) &&
    (!f.type || x.tx_type === f.type) && (!f.from || x.tx_date >= f.from) && (!f.to || x.tx_date <= f.to) &&
    (!s || [x.items?.name, x.items?.code, x.goods_receipt_notes?.grn_number, x.stock_transfers?.transfer_number, x.stock_adjustments?.adjustment_number].some((v) => v?.toLowerCase().includes(s))));
  const pageRows = rows.slice(page * PAGE, (page + 1) * PAGE);
  return (
    <>
      <PageHeader title="Stock Movements" subtitle="Entries are permanent — corrections are posted as new entries." />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="w-60"><SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Material, GRN, transfer, adjustment" /></div>
        <select className={cn(selectCls, "w-40")} value={f.wh} onChange={(e) => set("wh", e.target.value)}><option value="">All stores</option>{uniq(all, (x) => x.warehouse_id).map((x) => <option key={x.warehouse_id} value={x.warehouse_id}>{x.warehouses?.name}</option>)}</select>
        <select className={cn(selectCls, "w-40")} value={f.project} onChange={(e) => set("project", e.target.value)}><option value="">All projects</option>{uniq(all, (x) => x.project_id).map((x) => <option key={x.project_id!} value={x.project_id!}>{x.projects?.name}</option>)}</select>
        <select className={cn(selectCls, "w-40")} value={f.building} onChange={(e) => set("building", e.target.value)}><option value="">All buildings</option>{uniq(all, (x) => x.building_id).map((x) => <option key={x.building_id!} value={x.building_id!}>{x.buildings?.name}</option>)}</select>
        <select className={cn(selectCls, "w-40")} value={f.type} onChange={(e) => set("type", e.target.value)}><option value="">All types</option>{(Object.keys(TX_LABEL) as InvTxType[]).map((k) => <option key={k} value={k}>{TX_LABEL[k]}</option>)}</select>
        <Input type="date" className="h-9 w-40" value={f.from} onChange={(e) => set("from", e.target.value)} aria-label="From date" />
        <Input type="date" className="h-9 w-40" value={f.to} onChange={(e) => set("to", e.target.value)} aria-label="To date" />
      </div>
      {q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : (<>
        <div className="overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Material</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Store</th><th className="px-4 py-3 text-right">In</th><th className="px-4 py-3 text-right">Out</th><th className="px-4 py-3 text-right">Balance</th><th className="px-4 py-3 text-right">Value</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Building</th><th className="px-4 py-3">By</th></tr></thead>
            <tbody>
              {pageRows.length === 0 && <tr><td colSpan={12} className="p-4 text-xs text-muted-foreground">No stock movements match.</td></tr>}
              {pageRows.map((x) => (
                <tr key={x.id} className="border-b last:border-0 hover:bg-muted/40" title={x.remarks ?? undefined}>
                  <td className="px-4 py-3 text-xs">{fmtDateTime(x.created_at)}</td>
                  <td className="px-4 py-3">{x.items?.name}</td><td className="px-4 py-3">{TX_LABEL[x.tx_type]}</td>
                  <td className="px-4 py-3 font-medium tabular-nums text-xs">{x.grn_id ? <Link className="text-primary hover:underline" to="/inventory/goods-received/$id" params={{ id: x.grn_id }}>{x.goods_receipt_notes?.grn_number}</Link> : x.stock_transfers?.transfer_number ?? x.stock_adjustments?.adjustment_number ?? "—"}</td>
                  <td className="px-4 py-3">{x.warehouses?.name}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-success">{Number(x.quantity_in) ? num(x.quantity_in) : ""}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-destructive">{Number(x.quantity_out) ? num(x.quantity_out) : ""}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{num(x.balance_after)} <span className="text-[10px] text-muted-foreground">{x.items?.units_of_measure?.code}</span></td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{inr(x.total_cost)}</td>
                  <td className="px-4 py-3 text-xs">{x.projects?.name ?? "—"}</td><td className="px-4 py-3 text-xs">{x.buildings?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">{x.profiles?.full_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={rows.length} size={PAGE} onPage={setPage} />
      </>)}
    </>
  );
}
