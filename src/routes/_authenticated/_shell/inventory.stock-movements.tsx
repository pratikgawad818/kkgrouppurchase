import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Loading, PageHeader, SearchBox } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, fmtDateTime, inr, num } from "@/lib/format";
import { selectCls, TX_LABEL, type InvTxType } from "@/lib/po";
import { PAGE } from "@/lib/fy";
import { cn } from "@/lib/utils";
import { loadCompleteRows } from "@/lib/complete-register";
import { filterStockLedger } from "@/lib/stock-ledger-filter";

const META = "Permanent stock ledger of every material movement.";
export const Route = createFileRoute("/_authenticated/_shell/inventory/stock-movements")({
  head: () => ({ meta: [{ title: "Stock Movements — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Stock Movements — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Ledger,
});

function Ledger() {
  const [search, setSearch] = useState("");
  const [f, setF] = useState({ wh: "", project: "", building: "", type: "", from: "", to: "" });
  const [page, setPage] = useState(0);
  const deferredSearch = useDeferredValue(search);
  const q = useQuery({
    queryKey: ["stock-ledger"],
    queryFn: async () => {
      return loadCompleteRows(async (start,end) => await supabase.from("inventory_transactions")
        .select("id,created_at,tx_date,tx_type,quantity_in,quantity_out,unit_cost,total_cost,balance_after,grn_id,material_issue_id,material_return_id,warehouse_id,project_id,building_id,remarks,items(code,name,units_of_measure(code)),warehouses(name),projects(name),buildings(name),goods_receipt_notes(grn_number),stock_transfers(transfer_number),stock_adjustments(adjustment_number),material_issues(issue_number),material_returns(return_number,issue_id),profiles(full_name)", { count: "exact" })
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(start,end), { pageSize: 250, maxRows: 10000 });
    },
  });
  const all = q.data ?? [];
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(0); };
  const uniq = <T,>(arr: T[], key: (x: T) => string | null) => [...new Map(arr.filter((x) => key(x)).map((x) => [key(x)!, x])).values()];
  const rows = useMemo(() => filterStockLedger(q.data ?? [], f, deferredSearch), [q.data, f, deferredSearch]);
  const visiblePage = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE) - 1));
  const pageRows = rows.slice(visiblePage * PAGE, (visiblePage + 1) * PAGE);
  return (
    <>
      <PageHeader title="Stock Movements" subtitle="Entries are permanent — corrections are posted as new entries." />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="w-full sm:w-60"><SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Material, GRN, transfer, adjustment" /></div>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-40 sm:flex-none")} value={f.wh} onChange={(e) => set("wh", e.target.value)}><option value="">All stores</option>{uniq(all, (x) => x.warehouse_id).map((x) => <option key={x.warehouse_id} value={x.warehouse_id}>{x.warehouses?.name}</option>)}</select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-40 sm:flex-none")} value={f.project} onChange={(e) => set("project", e.target.value)}><option value="">All projects</option>{uniq(all, (x) => x.project_id).map((x) => <option key={x.project_id!} value={x.project_id!}>{x.projects?.name}</option>)}</select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-40 sm:flex-none")} value={f.building} onChange={(e) => set("building", e.target.value)}><option value="">All buildings</option>{uniq(all, (x) => x.building_id).map((x) => <option key={x.building_id!} value={x.building_id!}>{x.buildings?.name}</option>)}</select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-40 sm:flex-none")} value={f.type} onChange={(e) => set("type", e.target.value)}><option value="">All types</option>{(Object.keys(TX_LABEL) as InvTxType[]).map((k) => <option key={k} value={k}>{TX_LABEL[k]}</option>)}</select>
        <Input type="date" className="h-11 w-full min-w-0 sm:h-9 sm:w-40" value={f.from} onChange={(e) => set("from", e.target.value)} aria-label="From date" />
        <Input type="date" className="h-11 w-full min-w-0 sm:h-9 sm:w-40" value={f.to} onChange={(e) => set("to", e.target.value)} aria-label="To date" />
      </div>
      {q.isLoading ? <Loading /> : q.error ?
        <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
          Stock movement history is incomplete. No partial ledger is shown. {errMsg(q.error)}
          <button type="button" className="ml-2 font-semibold underline" onClick={() => void q.refetch()}>Retry</button>
        </div> : (<>
        <div className="doc-table overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Material</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Store</th><th className="px-4 py-3 text-right">In</th><th className="px-4 py-3 text-right">Out</th><th className="px-4 py-3 text-right">Balance</th><th className="px-4 py-3 text-right">Value</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Building</th><th className="px-4 py-3">By</th></tr></thead>
            <tbody>
              {pageRows.length === 0 && <tr><td colSpan={12} className="p-4 text-xs text-muted-foreground">No stock movements match.</td></tr>}
              {pageRows.map((x) => (
                <tr key={x.id} className="border-b last:border-0 hover:bg-muted/40" title={x.remarks ?? undefined}>
                  <td className="px-4 py-3 text-xs">{fmtDateTime(x.created_at)}</td>
                  <td className="px-4 py-3">{x.items?.name}</td><td className="px-4 py-3">{TX_LABEL[x.tx_type]}</td>
                  <td className="px-4 py-3 font-medium tabular-nums text-xs">{x.grn_id ? <Link className="text-primary hover:underline" to="/inventory/goods-received/$id" params={{ id: x.grn_id }}>{x.goods_receipt_notes?.grn_number}</Link> : x.material_issue_id ? <Link className="text-primary hover:underline" to="/inventory/material-issues/$id" params={{ id: x.material_issue_id }}>{x.material_issues?.issue_number}</Link> : x.material_return_id ? <Link className="text-primary hover:underline" to="/inventory/material-issues/$id" params={{ id: x.material_returns?.issue_id ?? "" }}>{x.material_returns?.return_number}</Link> : x.stock_transfers?.transfer_number ?? x.stock_adjustments?.adjustment_number ?? "—"}</td>
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
        <Pager page={visiblePage} total={rows.length} size={PAGE} onPage={setPage} />
      </>)}
    </>
  );
}
