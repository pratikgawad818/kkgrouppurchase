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
  const [adj, setAdj] = useState<null | "adjustment" | "opening_stock">(null);
  const q = useQuery({
    queryKey: ["stock"],
    queryFn: async () => {
      const [s, w, m] = await Promise.all([
        supabase.from("warehouse_stock").select("warehouse_id,material_id,quantity_on_hand,weighted_avg_cost,total_value,warehouses(name,code),items(code,name,minimum_stock,reorder_level,units_of_measure(code))").limit(2000),
        supabase.from("warehouses").select("id,name,code").eq("status", "active").order("name"),
        supabase.from("items").select("id,code,name,units_of_measure(code)").eq("status", "active").order("name").limit(2000),
      ]);
      if (s.error) throw s.error;
      return { stock: s.data ?? [], warehouses: w.data ?? [], materials: m.data ?? [] };
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
      <PageHeader title="Stock" subtitle="Stock changes only through posted goods receipts, transfers and authorised adjustments."
        actions={<div className="flex gap-2">
          {can("inventory.adjust") && <Button size="sm" variant="outline" onClick={() => setAdj("opening_stock")}>Opening stock</Button>}
          {can("inventory.adjust") && <Button size="sm" variant="outline" onClick={() => setAdj("adjustment")}>Adjust stock</Button>}
          {can("inventory.transfer") && <Button size="sm" onClick={() => setTransfer(true)}>Transfer stock</Button>}
        </div>} />
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
        <div className="overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Material</th><th className="px-4 py-3">Store</th><th className="px-4 py-3 text-right">On hand</th><th className="px-4 py-3 text-right">Reorder level</th><th className="px-4 py-3 text-right">Avg cost</th><th className="px-4 py-3 text-right">Value</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-xs text-muted-foreground">No stock yet. Stock appears after goods are received against a purchase order.</td></tr>}
              {rows.map((x) => { const st = status(x); return (
                <tr key={x.warehouse_id + x.material_id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3">{x.items?.name} <span className="font-mono text-[11px] text-muted-foreground">{x.items?.code}</span></td>
                  <td className="px-4 py-3">{x.warehouses?.name}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{num(x.quantity_on_hand)} {x.items?.units_of_measure?.code}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{num(x.items?.reorder_level)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{inr(x.weighted_avg_cost)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{inr(x.total_value)}</td>
                  <td className="px-4 py-3"><span className={cn("whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", st.c)}>{st.l}</span></td>
                </tr>); })}
            </tbody>
          </table>
        </div>
        {adj && <AdjustDialog kind={adj} stock={q.data!.stock} materials={q.data!.materials} warehouses={q.data!.warehouses} onClose={() => setAdj(null)} />}
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
            <tr key={x.material_id} className="border-b last:border-0 hover:bg-muted/40">
              <td className="p-1.5">{x.items?.name}</td><td className="p-1.5 text-right font-mono text-xs">avail {num(x.quantity_on_hand)}</td>
              <td className="p-1.5"><Input type="number" min={0} max={x.quantity_on_hand} className="h-8 w-24" value={qty[x.material_id] ?? ""} onChange={(e) => setQty({ ...qty, [x.material_id]: e.target.value })} /></td>
            </tr>))}</tbody></table>
        ))}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={save.isPending || !from || !to || !reason.trim()} onClick={() => save.mutate()}>Transfer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Mat = { id: string; code: string; name: string; units_of_measure: { code: string } | null };

function AdjustDialog({ kind, stock, materials, warehouses, onClose }: { kind: "adjustment" | "opening_stock"; stock: StockRow[]; materials: Mat[]; warehouses: { id: string; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [wh, setWh] = useState("");
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState("");
  const [vals, setVals] = useState<Record<string, { q: string; c: string }>>({});
  const opening = kind === "opening_stock";
  const onHand = (m: string) => Number(stock.find((x) => x.warehouse_id === wh && x.material_id === m)?.quantity_on_hand ?? 0);
  const hasRow = (m: string) => stock.some((x) => x.warehouse_id === wh && x.material_id === m);
  const f = filter.trim().toLowerCase();
  const list = materials.filter((m) => (opening ? !hasRow(m.id) : hasRow(m.id)) && (!f || m.name.toLowerCase().includes(f) || m.code.toLowerCase().includes(f))).slice(0, 100);
  const save = useMutation({
    mutationFn: async () => {
      const items = Object.entries(vals).filter(([, v]) => v.q !== "").map(([material_id, v]) => opening
        ? { material_id, quantity: Number(v.q), unit_cost: Number(v.c || 0) }
        : { material_id, physical_quantity: Number(v.q) });
      if (!wh) throw new Error("Choose a store");
      if (!items.length) throw new Error("Enter at least one quantity");
      const { error } = await supabase.rpc("create_stock_adjustment", { _warehouse_id: wh, _kind: kind, _items: items, _reason: reason.trim() });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(opening ? "Opening stock posted" : "Adjustment posted"); qc.invalidateQueries({ queryKey: ["stock"] }); qc.invalidateQueries({ queryKey: ["stock-ledger"] }); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{opening ? "Opening stock" : "Stock adjustment"}</DialogTitle>
          <DialogDescription>{opening ? "For materials with no movements yet in this store. Enter quantity and unit cost." : "Enter the physically counted quantity. The difference from system stock is posted to the ledger."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Store *"><select className={selectCls} value={wh} onChange={(e) => { setWh(e.target.value); setVals({}); }}><option value="">Select</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="Reason *"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={opening ? "e.g. Stock count on go-live" : "e.g. Physical count 30 Sep"} /></Field>
        </div>
        {wh && <>
          <SearchBox value={filter} onChange={setFilter} placeholder="Find material" />
          <div className="max-h-80 overflow-y-auto">
            {list.length === 0 ? <div className="p-2 text-xs text-muted-foreground">{opening ? "No materials without movements in this store." : "No stock in this store to adjust."}</div> : (
            <table className="w-full text-sm"><tbody>{list.map((m) => { const v = vals[m.id] ?? { q: "", c: "" }; const sys = onHand(m.id); const diff = v.q === "" ? null : Number(v.q) - sys; return (
              <tr key={m.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="p-1.5">{m.name} <span className="font-mono text-[11px] text-muted-foreground">{m.code}</span></td>
                {!opening && <td className="p-1.5 text-right font-mono text-xs">system {num(sys)}</td>}
                <td className="p-1.5"><Input type="number" min={0} className="h-8 w-24" placeholder={opening ? "Qty" : "Counted"} value={v.q} onChange={(e) => setVals({ ...vals, [m.id]: { ...v, q: e.target.value } })} /></td>
                {opening ? <td className="p-1.5"><Input type="number" min={0} className="h-8 w-24" placeholder="Unit cost" value={v.c} onChange={(e) => setVals({ ...vals, [m.id]: { ...v, c: e.target.value } })} /></td>
                  : <td className={cn("p-1.5 text-right font-mono text-xs", diff && diff < 0 ? "text-destructive" : "text-success")}>{diff == null || diff === 0 ? "" : (diff > 0 ? "+" : "") + num(diff)}</td>}
                <td className="p-1.5 text-xs text-muted-foreground">{m.units_of_measure?.code}</td>
              </tr>); })}</tbody></table>)}
          </div>
        </>}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={save.isPending || !reason.trim()} onClick={() => save.mutate()}>Post</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
