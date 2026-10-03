import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Loading, PageHeader, SearchBox, Stat } from "@/components/erp/common";
import { errMsg, inr, num } from "@/lib/format";
import { useCan } from "@/lib/session";
import { selectCls } from "@/lib/po";
import { cn } from "@/lib/utils";

const META = "Current stock by store and material, valued at weighted average cost.";
export const Route = createFileRoute("/_authenticated/_shell/inventory/stock")({
  head: () => ({ meta: [{ title: "Stock — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Stock — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: StockPage,
});

function StockPage() {
  const can = useCan();
  const [search, setSearch] = useState("");
  const [wh, setWh] = useState("");
  const [transfer, setTransfer] = useState(false);
  const q = useQuery({
    queryKey: ["stock"],
    queryFn: async () => {
      const [s, w] = await Promise.all([
        supabase.from("warehouse_stock").select("warehouse_id,material_id,quantity_on_hand,weighted_avg_cost,total_value,warehouses(name,code),items(code,name,minimum_stock,reorder_level,units_of_measure(code))").limit(2000),
        supabase.from("warehouses").select("id,name,code").eq("status", "active").order("name"),
      ]);
      if (s.error) throw s.error;
      return { stock: s.data ?? [], warehouses: w.data ?? [] };
    },
  });
  const s = search.trim().toLowerCase();
  const rows = (q.data?.stock ?? []).filter((x) => (!wh || x.warehouse_id === wh) && (!s || [x.items?.name, x.items?.code].some((v) => v?.toLowerCase().includes(s))));
  const status = (x: (typeof rows)[number]) => {
    const qty = Number(x.quantity_on_hand);
    if (qty <= 0) return { l: "Out of stock", c: "bg-destructive/10 text-destructive border-destructive/30" };
    if (qty <= Number(x.items?.reorder_level ?? 0)) return { l: "Low", c: "bg-warning/15 text-warning-foreground border-warning/40" };
    return { l: "Normal", c: "bg-success/15 text-success border-success/40" };
  };
  const total = rows.reduce((a, x) => a + Number(x.total_value), 0);
  return (
    <>
      <PageHeader title="Stock" subtitle="Stock increases only from posted goods receipts and transfers."
        actions={can("inventory.transfer") ? <Button size="sm" onClick={() => setTransfer(true)}>Transfer stock</Button> : null} />
      {q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : <>
        <div className="mb-3 grid gap-3 md:grid-cols-3">
          <Stat label="Stock value" value={inr(total)} />
          <Stat label="Low stock lines" value={rows.filter((x) => status(x).l === "Low").length} />
          <Stat label="Out of stock lines" value={rows.filter((x) => status(x).l === "Out of stock").length} />
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="w-64"><SearchBox value={search} onChange={setSearch} placeholder="Material" /></div>
          <select className={cn(selectCls, "w-56")} value={wh} onChange={(e) => setWh(e.target.value)}><option value="">All stores</option>{q.data!.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        </div>
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="p-2">Material</th><th className="p-2">Store</th><th className="p-2 text-right">On hand</th><th className="p-2 text-right">Reorder level</th><th className="p-2 text-right">Avg cost</th><th className="p-2 text-right">Value</th><th className="p-2">Status</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-xs text-muted-foreground">No stock yet. Stock appears after goods are received against a purchase order.</td></tr>}
              {rows.map((x) => { const st = status(x); return (
                <tr key={x.warehouse_id + x.material_id} className="border-b last:border-0">
                  <td className="p-2">{x.items?.name} <span className="font-mono text-[11px] text-muted-foreground">{x.items?.code}</span></td>
                  <td className="p-2">{x.warehouses?.name}</td>
                  <td className="p-2 text-right font-mono">{num(x.quantity_on_hand)} {x.items?.units_of_measure?.code}</td>
                  <td className="p-2 text-right font-mono">{num(x.items?.reorder_level)}</td>
                  <td className="p-2 text-right font-mono">{inr(x.weighted_avg_cost)}</td>
                  <td className="p-2 text-right font-mono">{inr(x.total_value)}</td>
                  <td className="p-2"><span className={cn("rounded-sm border px-1.5 py-0.5 text-[11px]", st.c)}>{st.l}</span></td>
                </tr>); })}
            </tbody>
          </table>
        </div>
        {transfer && <TransferDialog stock={q.data!.stock} warehouses={q.data!.warehouses} onClose={() => setTransfer(false)} />}
      </>}
    </>
  );
}

type StockRow = { warehouse_id: string; material_id: string; quantity_on_hand: number; items: { name: string; code: string } | null };

function TransferDialog({ stock, warehouses, onClose }: { stock: StockRow[]; warehouses: { id: string; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const avail = stock.filter((x) => x.warehouse_id === from && Number(x.quantity_on_hand) > 0);
  const save = useMutation({
    mutationFn: async () => {
      const items = avail.map((x) => ({ material_id: x.material_id, quantity: Number(qty[x.material_id] || 0) })).filter((x) => x.quantity > 0);
      if (!items.length) throw new Error("Enter a quantity for at least one material");
      const { error } = await supabase.rpc("execute_stock_transfer", { _from: from, _to: to, _items: items, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Stock transferred"); qc.invalidateQueries({ queryKey: ["stock"] }); qc.invalidateQueries({ queryKey: ["stock-ledger"] }); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Transfer stock</DialogTitle><DialogDescription>Moves stock at its current average cost. Both stores get a ledger entry.</DialogDescription></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="From store"><select className={selectCls} value={from} onChange={(e) => { setFrom(e.target.value); setQty({}); }}><option value="">Select</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="To store"><select className={selectCls} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select</option>{warehouses.filter((w) => w.id !== from).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="Reason *" className="md:col-span-2"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        {from && (avail.length === 0 ? <div className="text-xs text-muted-foreground">No stock in this store.</div> : (
          <table className="w-full text-sm"><tbody>{avail.map((x) => (
            <tr key={x.material_id} className="border-b last:border-0">
              <td className="p-1.5">{x.items?.name}</td><td className="p-1.5 text-right font-mono text-xs">avail {num(x.quantity_on_hand)}</td>
              <td className="p-1.5"><Input type="number" min={0} max={x.quantity_on_hand} className="h-8 w-24" value={qty[x.material_id] ?? ""} onChange={(e) => setQty({ ...qty, [x.material_id]: e.target.value })} /></td>
            </tr>))}</tbody></table>
        ))}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={save.isPending || !from || !to || !reason.trim()} onClick={() => save.mutate()}>Transfer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
