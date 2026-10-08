import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loading, PageHeader } from "@/components/erp/common";
import { errMsg, fmtDate, fmtDateTime, inr, num } from "@/lib/format";
import { useCan } from "@/lib/session";
import { GRN_STATUS, TX_LABEL } from "@/lib/po";
import { cn } from "@/lib/utils";

const DISP_LABEL: Record<string, string> = { pending_decision: "Pending Decision", replacement_expected: "Replacement Expected", short_close: "Short Closed", return_to_vendor: "Return to Vendor", credit_note_expected: "Credit Note Expected", accepted_under_concession: "Accepted Under Concession" };
const META = "Goods receipt note with accepted, damaged and rejected quantities.";
export const Route = createFileRoute("/_authenticated/_shell/inventory/goods-received/$id")({
  head: () => ({ meta: [{ title: "Goods Receipt — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Goods Receipt — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: GrnDetail,
});

function GrnDetail() {
  const { id } = Route.useParams();
  const can = useCan();
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [disp, setDisp] = useState<null | { id: string; to: "pending_decision" | "replacement_expected" | "short_close"; qty: number }>(null);
  const [dReason, setDReason] = useState("");
  const q = useQuery({
    queryKey: ["grn", id],
    queryFn: async () => {
      const [g, i, t] = await Promise.all([
        supabase.from("goods_receipt_notes").select("*, purchase_orders(po_number,purchase_order_items(id,ordered_quantity,received_quantity,accepted_quantity,short_closed_quantity)), rfqs(rfq_number), purchase_requests(pr_number), vendors(company_name), warehouses(name), projects(name), buildings(name), profiles!goods_receipt_notes_received_by_fkey(full_name)").eq("id", id).single(),
        supabase.from("goods_receipt_items").select("*, items(code,name), units_of_measure(code)").eq("grn_id", id),
        supabase.from("inventory_transactions").select("id,created_at,tx_type,quantity_in,quantity_out,balance_after,unit_cost,total_cost,remarks,items(name),warehouses(name)").eq("grn_id", id).order("id"),
      ]);
      if (g.error) throw g.error;
      return { g: g.data, items: i.data ?? [], txs: t.data ?? [] };
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["grn", id] }); qc.invalidateQueries({ queryKey: ["grns"] }); qc.invalidateQueries({ queryKey: ["stock"] }); qc.invalidateQueries({ queryKey: ["stock-ledger"] }); qc.invalidateQueries({ queryKey: ["po"] }); qc.invalidateQueries({ queryKey: ["pos"] }); };
  const post = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("post_goods_receipt", { _grn_id: id }); if (error) throw error; },
    onSuccess: () => { toast.success("Posted to stock"); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const cancel = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("cancel_goods_receipt", { _grn_id: id, _reason: reason.trim() }); if (error) throw error; },
    onSuccess: () => { toast.success("GRN cancelled"); setCancelOpen(false); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const setDisposition = useMutation({
    mutationFn: async () => {
      if (!disp) return;
      if (disp.to === "short_close" && !dReason.trim()) throw new Error("A reason is required to short-close");
      const { error } = await supabase.rpc("set_grn_disposition", { _grn_item: disp.id, _disposition: disp.to, _reason: dReason.trim() });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Decision recorded"); setDisp(null); setDReason(""); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="text-sm text-destructive">{errMsg(q.error)}</div>;
  const { g, items, txs } = q.data!;
  const st = GRN_STATUS[g.status];
  const poItems = g.purchase_orders?.purchase_order_items ?? [];
  return (
    <>
      <PageHeader crumbs={<Link to="/inventory/goods-received" className="hover:underline">Goods Received</Link>} title={g.grn_number}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span>{g.vendors?.company_name} · {g.warehouses?.name}</span>}
        actions={<div className="flex gap-2">
          {g.status === "draft" && can("grn.post") && <Button size="sm" disabled={post.isPending} onClick={() => post.mutate()}>Post to stock</Button>}
          {g.status !== "cancelled" && can("grn.cancel") && <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>Cancel GRN</Button>}
        </div>} />
      {g.status === "draft" && <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">Draft — not yet in stock. A user with posting rights must post it.</div>}
      {g.status === "cancelled" && <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs">Cancelled {fmtDateTime(g.cancelled_at)} — “{g.cancel_reason}”. Any stock it added was reversed.</div>}
      <section className="grid gap-3 rounded-md border bg-card p-4 text-sm md:grid-cols-4">
        <Info l="Purchase order" v={<Link className="font-mono text-primary hover:underline" to="/procurement/purchase-orders/$id" params={{ id: g.po_id }}>{g.purchase_orders?.po_number}</Link>} />
        <Info l="RFQ" v={g.rfq_id ? <Link className="font-mono text-primary hover:underline" to="/procurement/rfqs/$id" params={{ id: g.rfq_id }}>{g.rfqs?.rfq_number}</Link> : "—"} />
        <Info l="Purchase request" v={g.purchase_request_id ? <Link className="font-mono text-primary hover:underline" to="/procurement/purchase-requests/$id" params={{ id: g.purchase_request_id }}>{g.purchase_requests?.pr_number}</Link> : "—"} />
        <Info l="Received date" v={fmtDate(g.received_date)} />
        <Info l="Project" v={g.projects?.name} /><Info l="Building" v={g.buildings?.name ?? "—"} />
        <Info l="Received by" v={g.profiles?.full_name ?? "—"} /><Info l="Challan" v={g.challan_number ?? "—"} />
        <Info l="Vendor invoice ref." v={g.invoice_reference ?? "—"} /><Info l="Vehicle" v={g.vehicle_number ?? "—"} /><Info l="Remarks" v={g.remarks ?? "—"} />
      </section>
      <section className="mt-4 overflow-x-auto rounded-xl border bg-card shadow-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Material</th><th className="px-4 py-3 text-right">Ordered</th><th className="px-4 py-3 text-right">Previously received</th><th className="px-4 py-3 text-right">Physically received</th><th className="px-4 py-3 text-right">PO remaining</th><th className="px-4 py-3 text-right">Damaged</th><th className="px-4 py-3 text-right">Rejected</th><th className="px-4 py-3 text-right">Accepted</th><th className="px-4 py-3 text-right">Unit cost</th><th className="px-4 py-3">Disposition</th></tr></thead>
          <tbody>{items.map((x) => { const pi = poItems.find((p) => p.id === x.po_item_id); return (
            <tr key={x.id} className="border-b last:border-0 hover:bg-muted/40">
              <td className="px-4 py-3">{x.items?.name} <span className="font-mono text-[11px] text-muted-foreground">{x.items?.code}</span></td>
              <td className="px-4 py-3 text-right font-mono">{num(x.ordered_quantity)} {x.units_of_measure?.code}</td>
              <td className="px-4 py-3 text-right font-mono">{num(x.previously_received)}</td>
              <td className="px-4 py-3 text-right font-mono">{num(x.received_quantity)}</td>
              <td className="px-4 py-3 text-right font-mono">{pi ? num(Number(pi.ordered_quantity) - Number(pi.accepted_quantity) - Number(pi.short_closed_quantity)) : "—"}</td>
              <td className="px-4 py-3 text-right font-mono text-destructive">{num(x.damaged_quantity)}</td>
              <td className="px-4 py-3 text-right font-mono text-destructive">{num(x.rejected_quantity)}</td>
              <td className="px-4 py-3 text-right font-mono font-semibold">{num(x.accepted_quantity)}</td>
              <td className="px-4 py-3 text-right font-mono">{inr(x.unit_cost)}</td>
              <td className="px-4 py-3 text-xs">{Number(x.damaged_quantity) + Number(x.rejected_quantity) === 0 ? "—" : (<div>
                <div className="font-medium">{DISP_LABEL[x.disposition] ?? x.disposition}{x.disposition === "short_close" ? ` (${num(x.short_closed_quantity)})` : ""}</div>
                {x.disposition_reason && <div className="text-muted-foreground">“{x.disposition_reason}”</div>}
                {g.status === "posted" && x.disposition !== "short_close" && can("grn.create") && <select aria-label="Change disposition" className="mt-1 h-7 rounded border bg-background px-1 text-xs" value="" onChange={(e) => e.target.value && setDisp({ id: x.id, to: e.target.value as "pending_decision", qty: Number(x.damaged_quantity) + Number(x.rejected_quantity) })}>
                  <option value="">Change…</option>
                  {x.disposition !== "pending_decision" && <option value="pending_decision">Pending Decision</option>}
                  {x.disposition !== "replacement_expected" && <option value="replacement_expected">Replacement Expected</option>}
                  {can("purchase_order.short_close") && <option value="short_close">Short Close</option>}
                </select>}
              </div>)}</td>
            </tr>); })}
          </tbody>
        </table>
      </section>
      <section className="mt-4 rounded-md border bg-card p-4">
        <div className="mb-2 text-sm font-semibold">Stock entries created by this GRN</div>
        {txs.length === 0 ? <div className="text-xs text-muted-foreground">None{g.status === "draft" ? " yet — the GRN is a draft." : "."}</div> : (
          <table className="w-full text-sm"><tbody>{txs.map((t) => (
            <tr key={t.id} className="border-b last:border-0 hover:bg-muted/40">
              <td className="p-1.5 text-xs">{fmtDateTime(t.created_at)}</td><td className="p-1.5">{TX_LABEL[t.tx_type]}</td><td className="p-1.5">{t.items?.name}</td><td className="p-1.5">{t.warehouses?.name}</td>
              <td className="p-1.5 text-right font-mono">{Number(t.quantity_in) ? `+${num(t.quantity_in)}` : `−${num(t.quantity_out)}`}</td>
              <td className="p-1.5 text-right font-mono">bal {num(t.balance_after)}</td><td className="p-1.5 text-right font-mono">{inr(t.total_cost)}</td>
            </tr>))}</tbody></table>
        )}
      </section>
      <p className="mt-2 text-xs text-muted-foreground">Posted receipts are never edited. Corrections are made by cancelling, which posts reversal entries.</p>
      <Dialog open={!!disp} onOpenChange={(o) => !o && setDisp(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{disp ? DISP_LABEL[disp.to] : ""}</DialogTitle><DialogDescription>{disp?.to === "short_close" ? `Short-close up to ${num(disp.qty)} damaged/rejected units. They will no longer be expected from the vendor; accepted quantity stays the same.` : "This decision is recorded in the audit trail."}</DialogDescription></DialogHeader>
          <Textarea value={dReason} onChange={(e) => setDReason(e.target.value)} placeholder={disp?.to === "short_close" ? "Reason (required)" : "Reason (optional)"} />
          <DialogFooter><Button variant="ghost" onClick={() => setDisp(null)}>Cancel</Button><Button disabled={setDisposition.isPending || (disp?.to === "short_close" && !dReason.trim())} onClick={() => setDisposition.mutate()}>Confirm</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel {g.grn_number}</DialogTitle><DialogDescription>Stock added by this receipt is reversed and the PO pending quantity is restored. A reason is required.</DialogDescription></DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
          <DialogFooter><Button disabled={cancel.isPending || !reason.trim()} onClick={() => cancel.mutate()}>Confirm cancellation</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Info({ l, v }: { l: string; v: React.ReactNode }) {
  return <div><div className="text-[11px] uppercase text-muted-foreground">{l}</div><div className="mt-0.5">{v}</div></div>;
}
