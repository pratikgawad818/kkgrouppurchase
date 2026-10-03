import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loading, PageHeader, SearchBox } from "@/components/erp/common";
import { errMsg, fmtDateTime, inr, num } from "@/lib/format";
import { TX_LABEL } from "@/lib/po";

const META = "Permanent stock ledger of every material movement.";
export const Route = createFileRoute("/_authenticated/_shell/inventory/stock-movements")({
  head: () => ({ meta: [{ title: "Stock Movements — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Stock Movements — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Ledger,
});

function Ledger() {
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["stock-ledger"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_transactions").select("id,created_at,tx_type,quantity_in,quantity_out,unit_cost,total_cost,balance_after,grn_id,items(code,name),warehouses(name),goods_receipt_notes(grn_number),stock_transfers(transfer_number,reason),profiles(full_name)").order("id", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  const s = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((x) => !s || [x.items?.name, x.items?.code, x.warehouses?.name, x.goods_receipt_notes?.grn_number, x.stock_transfers?.transfer_number].some((v) => v?.toLowerCase().includes(s)));
  return (
    <>
      <PageHeader title="Stock Movements" subtitle="Entries are permanent — corrections are posted as new entries." />
      <div className="mb-3 w-72"><SearchBox value={search} onChange={setSearch} placeholder="Material, store, GRN, transfer" /></div>
      {q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="p-2">When</th><th className="p-2">Type</th><th className="p-2">Material</th><th className="p-2">Store</th><th className="p-2">Reference</th><th className="p-2 text-right">In</th><th className="p-2 text-right">Out</th><th className="p-2 text-right">Balance</th><th className="p-2 text-right">Unit cost</th><th className="p-2 text-right">Value</th><th className="p-2">By</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={11} className="p-4 text-xs text-muted-foreground">No stock movements yet.</td></tr>}
              {rows.map((x) => (
                <tr key={x.id} className="border-b last:border-0">
                  <td className="p-2 text-xs">{fmtDateTime(x.created_at)}</td><td className="p-2">{TX_LABEL[x.tx_type]}</td>
                  <td className="p-2">{x.items?.name}</td><td className="p-2">{x.warehouses?.name}</td>
                  <td className="p-2 font-mono text-xs">{x.grn_id ? <Link className="text-primary hover:underline" to="/inventory/goods-received/$id" params={{ id: x.grn_id }}>{x.goods_receipt_notes?.grn_number}</Link> : x.stock_transfers?.transfer_number ?? "—"}</td>
                  <td className="p-2 text-right font-mono text-success">{Number(x.quantity_in) ? num(x.quantity_in) : ""}</td>
                  <td className="p-2 text-right font-mono text-destructive">{Number(x.quantity_out) ? num(x.quantity_out) : ""}</td>
                  <td className="p-2 text-right font-mono">{num(x.balance_after)}</td>
                  <td className="p-2 text-right font-mono">{inr(x.unit_cost)}</td><td className="p-2 text-right font-mono">{inr(x.total_cost)}</td>
                  <td className="p-2 text-xs">{x.profiles?.full_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
