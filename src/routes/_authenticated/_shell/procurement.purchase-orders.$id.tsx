import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Loading, PageHeader } from "@/components/erp/common";
import { errMsg, fmtDate, fmtDateTime, inr, num } from "@/lib/format";
import { useCan, useMe } from "@/lib/session";
import { PO_ACTION_LABEL, PO_STATUS, selectCls, type PoAction } from "@/lib/po";
import { cn } from "@/lib/utils";

const META = "Purchase order details, approval and goods receipts.";
export const Route = createFileRoute("/_authenticated/_shell/procurement/purchase-orders/$id")({
  head: () => ({ meta: [{ title: "Purchase Order — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Purchase Order — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: PoDetail,
});

async function loadPo(id: string) {
  const [p, i, a, g, w] = await Promise.all([
    supabase.from("purchase_orders").select("*, vendors(company_name,gstin,address,city), projects(name), buildings(name), rfqs(rfq_number), purchase_requests(pr_number), warehouses(name)").eq("id", id).single(),
    supabase.from("purchase_order_items").select("*, items(code,name), units_of_measure(code)").eq("po_id", id).order("line_no"),
    supabase.from("purchase_order_approvals").select("*, profiles(full_name)").eq("po_id", id).order("acted_at"),
    supabase.from("goods_receipt_notes").select("id,grn_number,received_date,challan_number,warehouses(name)").eq("po_id", id).order("created_at"),
    supabase.from("warehouses").select("id,name,code").eq("status", "active").order("name"),
  ]);
  if (p.error) throw p.error;
  return { po: p.data, items: i.data ?? [], history: a.data ?? [], grns: g.data ?? [], warehouses: w.data ?? [] };
}

function PoDetail() {
  const { id } = Route.useParams();
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["po", id], queryFn: () => loadPo(id) });
  const [dlg, setDlg] = useState<null | PoAction>(null);
  const [comment, setComment] = useState("");
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [terms, setTerms] = useState({ delivery_warehouse_id: "", expected_delivery_date: "", payment_terms: "", delivery_terms: "", remarks: "" });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["po", id] }); qc.invalidateQueries({ queryKey: ["pos"] }); };

  useEffect(() => {
    const p = q.data?.po;
    if (p) setTerms({ delivery_warehouse_id: p.delivery_warehouse_id ?? "", expected_delivery_date: p.expected_delivery_date ?? "", payment_terms: p.payment_terms ?? "", delivery_terms: p.delivery_terms ?? "", remarks: p.remarks ?? "" });
  }, [q.data?.po]);

  const saveTerms = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("purchase_orders").update({
        delivery_warehouse_id: terms.delivery_warehouse_id || null, expected_delivery_date: terms.expected_delivery_date || null,
        payment_terms: terms.payment_terms || null, delivery_terms: terms.delivery_terms || null, remarks: terms.remarks || null,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Saved"); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const act = useMutation({
    mutationFn: async (a: PoAction) => {
      const { error } = await supabase.rpc("po_transition", { _po_id: id, _action: a, _comment: comment.trim() });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Updated"); setDlg(null); setComment(""); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="text-sm text-destructive">{errMsg(q.error)}</div>;
  const { po, items, history, grns, warehouses } = q.data!;
  const mine = po.created_by === me.data?.id;
  const st = PO_STATUS[po.status];
  const draft = po.status === "draft" || po.status === "rejected";
  const canReceive = ["approved", "sent", "partially_received"].includes(po.status) && can("grn.create");
  const needsComment = dlg === "rejected" || dlg === "cancelled" || (dlg === "closed" && po.status === "partially_received");

  return (
    <>
      <PageHeader
        crumbs={<Link to="/procurement/purchase-orders" className="hover:underline">Purchase Orders</Link>}
        title={po.po_number}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className={cn("rounded-sm border px-1.5 py-0.5 text-[11px]", st.cls)}>{st.label}</span>{po.vendors?.company_name} · {po.projects?.name}{po.buildings?.name ? ` · ${po.buildings.name}` : ""}</span>}
        actions={<div className="flex flex-wrap gap-2">
          {draft && can("purchase_order.create") && <Button size="sm" disabled={act.isPending} onClick={() => act.mutate("submitted")}>Submit for approval</Button>}
          {po.status === "pending_approval" && can("purchase_order.approve") && !mine && <>
            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate("approved")}>Approve</Button>
            <Button size="sm" variant="outline" onClick={() => setDlg("rejected")}>Reject</Button>
          </>}
          {po.status === "approved" && can("purchase_order.create") && <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate("sent")}>Mark as sent</Button>}
          {canReceive && <Button size="sm" onClick={() => setReceiveOpen(true)}>Receive goods</Button>}
          {["partially_received", "fully_received"].includes(po.status) && can("purchase_order.approve") && <Button size="sm" variant="outline" onClick={() => setDlg("closed")}>Close PO</Button>}
          {["draft", "pending_approval", "approved", "rejected", "sent"].includes(po.status) && grns.length === 0 && can("purchase_order.cancel") && <Button size="sm" variant="ghost" onClick={() => setDlg("cancelled")}>Cancel</Button>}
          <Button size="sm" variant="ghost" onClick={() => window.print()}>Print</Button>
        </div>}
      />
      {po.status === "pending_approval" && mine && <div className="mb-3 text-xs text-muted-foreground">Another approver must approve this PO — you created it.</div>}

      <section className="grid gap-3 rounded-md border bg-card p-4 text-sm md:grid-cols-4">
        <Info label="RFQ" value={<Link className="font-mono text-primary hover:underline" to="/procurement/rfqs/$id" params={{ id: po.rfq_id }}>{po.rfqs?.rfq_number}</Link>} />
        <Info label="Purchase request" value={<Link className="font-mono text-primary hover:underline" to="/procurement/purchase-requests/$id" params={{ id: po.purchase_request_id }}>{po.purchase_requests?.pr_number}</Link>} />
        <Info label="PO date" value={fmtDate(po.po_date)} />
        <Info label="Vendor GSTIN" value={po.vendors?.gstin ?? "—"} />
        {!draft && <>
          <Info label="Delivery store" value={po.warehouses?.name ?? "—"} />
          <Info label="Expected delivery" value={fmtDate(po.expected_delivery_date)} />
          <Info label="Payment terms" value={po.payment_terms ?? "—"} />
          <Info label="Delivery terms" value={po.delivery_terms ?? "—"} />
        </>}
      </section>

      {draft && can("purchase_order.create") && (
        <section className="mt-4 rounded-md border bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Delivery & terms</div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Delivery store *"><select className={selectCls} value={terms.delivery_warehouse_id} onChange={(e) => setTerms({ ...terms, delivery_warehouse_id: e.target.value })}><option value="">Select store</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select></Field>
            <Field label="Expected delivery"><Input type="date" value={terms.expected_delivery_date} onChange={(e) => setTerms({ ...terms, expected_delivery_date: e.target.value })} /></Field>
            <Field label="Payment terms"><Input value={terms.payment_terms} onChange={(e) => setTerms({ ...terms, payment_terms: e.target.value })} /></Field>
            <Field label="Delivery terms"><Input value={terms.delivery_terms} onChange={(e) => setTerms({ ...terms, delivery_terms: e.target.value })} /></Field>
            <Field label="Remarks" className="md:col-span-2"><Input value={terms.remarks} onChange={(e) => setTerms({ ...terms, remarks: e.target.value })} /></Field>
          </div>
          <Button className="mt-3" size="sm" variant="outline" disabled={saveTerms.isPending} onClick={() => saveTerms.mutate()}>Save terms</Button>
        </section>
      )}

      <section className="mt-4 overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="p-2">#</th><th className="p-2">Material</th><th className="p-2 text-right">Ordered</th><th className="p-2 text-right">Received</th><th className="p-2 text-right">Pending</th><th className="p-2 text-right">Rate</th><th className="p-2 text-right">Discount</th><th className="p-2 text-right">Tax</th><th className="p-2 text-right">Line total</th></tr></thead>
          <tbody>{items.map((x) => (
            <tr key={x.id} className="border-b last:border-0">
              <td className="p-2">{x.line_no}</td>
              <td className="p-2"><div className="font-medium">{x.items?.name}</div><div className="font-mono text-[11px] text-muted-foreground">{x.items?.code}</div></td>
              <td className="p-2 text-right font-mono">{num(x.ordered_quantity)} {x.units_of_measure?.code}</td>
              <td className="p-2 text-right font-mono">{num(x.received_quantity)}</td>
              <td className="p-2 text-right font-mono">{num(Number(x.ordered_quantity) - Number(x.received_quantity))}</td>
              <td className="p-2 text-right font-mono">{inr(x.rate)}</td>
              <td className="p-2 text-right font-mono">{inr(x.discount_amount)}</td>
              <td className="p-2 text-right font-mono">{inr(x.tax_amount)} <span className="text-[10px] text-muted-foreground">{x.tax_rate_percent}%</span></td>
              <td className="p-2 text-right font-mono">{inr(x.line_total)}</td>
            </tr>))}
          </tbody>
          <tfoot className="text-sm">
            {[["Subtotal", po.subtotal], ["Discount", -Number(po.discount_total)], ["Tax", po.tax_total], ["Freight", po.freight], ["Other charges", po.other_charges]].map(([l, v]) => <tr key={l as string}><td colSpan={8} className="p-1.5 text-right text-muted-foreground">{l}</td><td className="p-1.5 text-right font-mono">{inr(v as number)}</td></tr>)}
            <tr className="border-t font-semibold"><td colSpan={8} className="p-2 text-right">Grand total</td><td className="p-2 text-right font-mono">{inr(po.grand_total)}</td></tr>
          </tfoot>
        </table>
      </section>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-md border bg-card p-4">
          <div className="mb-2 text-sm font-semibold">Goods receipts</div>
          {grns.length === 0 ? <div className="text-xs text-muted-foreground">Nothing received yet.</div> : (
            <ul className="space-y-1 text-sm">{grns.map((g) => <li key={g.id} className="flex justify-between"><Link className="font-mono text-primary hover:underline" to="/inventory/goods-received/$id" params={{ id: g.id }}>{g.grn_number}</Link><span className="text-xs text-muted-foreground">{fmtDate(g.received_date)} · {g.warehouses?.name}</span></li>)}</ul>
          )}
        </section>
        <section className="rounded-md border bg-card p-4">
          <div className="mb-2 text-sm font-semibold">Approval history</div>
          <ol className="space-y-2 text-sm">{history.map((h) => (
            <li key={h.id} className="border-l-2 border-primary/40 pl-3">
              <div className="font-medium">{PO_ACTION_LABEL[h.action]} <span className="font-normal text-muted-foreground">by {h.profiles?.full_name ?? "—"}</span></div>
              <div className="text-xs text-muted-foreground">{fmtDateTime(h.acted_at)}</div>
              {h.comment && <div className="mt-0.5 text-xs">“{h.comment}”</div>}
            </li>))}
          </ol>
        </section>
      </div>

      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dlg ? PO_ACTION_LABEL[dlg] : ""}</DialogTitle><DialogDescription>{needsComment ? "A reason is required and will be kept in the history." : "Optional comment."}</DialogDescription></DialogHeader>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Reason" />
          <DialogFooter><Button disabled={act.isPending || (needsComment && !comment.trim())} onClick={() => dlg && act.mutate(dlg)}>Confirm</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {receiveOpen && <ReceiveDialog poId={id} defaultWh={po.delivery_warehouse_id ?? ""} warehouses={warehouses} items={items} onClose={() => setReceiveOpen(false)} onDone={refresh} />}
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="text-[11px] uppercase text-muted-foreground">{label}</div><div className="mt-0.5">{value}</div></div>;
}

type PoItem = { id: string; line_no: number; ordered_quantity: number; received_quantity: number; items: { name: string; code: string } | null; units_of_measure: { code: string } | null };

function ReceiveDialog({ poId, defaultWh, warehouses, items, onClose, onDone }: { poId: string; defaultWh: string; warehouses: { id: string; name: string; code: string }[]; items: PoItem[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [wh, setWh] = useState(defaultWh);
  const [h, setH] = useState({ received_date: new Date().toISOString().slice(0, 10), challan_number: "", invoice_reference: "", vehicle_number: "", remarks: "" });
  const open = items.filter((x) => Number(x.ordered_quantity) > Number(x.received_quantity));
  const [lines, setLines] = useState<Record<string, { r: string; d: string }>>({});
  const save = useMutation({
    mutationFn: async () => {
      const payload = open.map((x) => ({ po_item_id: x.id, received_quantity: Number(lines[x.id]?.r || 0), damaged_quantity: Number(lines[x.id]?.d || 0) })).filter((x) => x.received_quantity > 0);
      if (!wh) throw new Error("Choose the receiving store");
      if (!payload.length) throw new Error("Enter a received quantity for at least one line");
      const { data, error } = await supabase.rpc("create_goods_receipt", { _po_id: poId, _warehouse_id: wh, _header: h, _items: payload });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Goods receipt posted to stock"); qc.invalidateQueries({ queryKey: ["stock"] }); qc.invalidateQueries({ queryKey: ["grns"] }); onDone(); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Receive goods</DialogTitle><DialogDescription>Only accepted quantity (received − damaged) is added to stock. You cannot receive more than pending.</DialogDescription></DialogHeader>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Receiving store *"><select className={selectCls} value={wh} onChange={(e) => setWh(e.target.value)}><option value="">Select store</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="Received date"><Input type="date" value={h.received_date} onChange={(e) => setH({ ...h, received_date: e.target.value })} /></Field>
          <Field label="Delivery challan no."><Input value={h.challan_number} onChange={(e) => setH({ ...h, challan_number: e.target.value })} /></Field>
          <Field label="Vendor invoice ref."><Input value={h.invoice_reference} onChange={(e) => setH({ ...h, invoice_reference: e.target.value })} /></Field>
          <Field label="Vehicle no."><Input value={h.vehicle_number} onChange={(e) => setH({ ...h, vehicle_number: e.target.value })} /></Field>
          <Field label="Remarks"><Input value={h.remarks} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></Field>
        </div>
        <table className="mt-2 w-full text-sm">
          <thead className="border-b text-left text-[11px] uppercase text-muted-foreground"><tr><th className="p-1.5">Material</th><th className="p-1.5 text-right">Pending</th><th className="p-1.5">Received</th><th className="p-1.5">Damaged</th><th className="p-1.5 text-right">Accepted</th></tr></thead>
          <tbody>{open.map((x) => {
            const pending = Number(x.ordered_quantity) - Number(x.received_quantity);
            const l = lines[x.id] ?? { r: "", d: "" };
            const over = Number(l.r || 0) > pending;
            return (
              <tr key={x.id} className="border-b last:border-0">
                <td className="p-1.5">{x.items?.name}</td>
                <td className="p-1.5 text-right font-mono">{num(pending)} {x.units_of_measure?.code}</td>
                <td className="p-1.5"><Input type="number" min={0} className={cn("h-8 w-24", over && "border-destructive")} value={l.r} onChange={(e) => setLines({ ...lines, [x.id]: { ...l, r: e.target.value } })} /></td>
                <td className="p-1.5"><Input type="number" min={0} className="h-8 w-24" value={l.d} onChange={(e) => setLines({ ...lines, [x.id]: { ...l, d: e.target.value } })} /></td>
                <td className="p-1.5 text-right font-mono">{num(Math.max(0, Number(l.r || 0) - Number(l.d || 0)))}</td>
              </tr>);
          })}</tbody>
        </table>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>Post goods receipt</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
