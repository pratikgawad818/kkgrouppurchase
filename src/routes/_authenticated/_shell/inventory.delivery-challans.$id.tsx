import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCan } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loading, PageHeader } from "@/components/erp/common";
import { errMsg, fmtDate, fmtDateTime, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/_shell/inventory/delivery-challans/$id")({
  head: () => ({ meta: [{ title: "Delivery Challan — KK GROUP ERP" }] }),
  component: ChallanDetails,
});

function ChallanDetails() {
  const { id } = Route.useParams();
  const can = useCan();
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const q = useQuery({
    queryKey: ["vendor-delivery-challan", id],
    queryFn: async () => {
      const [header, lines, receipts] = await Promise.all([
        supabase.from("vendor_delivery_challans").select("*,purchase_orders(po_number),vendors(company_name),projects(name),buildings(name),profiles!vendor_delivery_challans_created_by_fkey(full_name)").eq("id", id).single(),
        supabase.from("vendor_delivery_challan_items").select("id,quantity,po_item_id,purchase_order_items(line_no,items(name,code),units_of_measure(code))").eq("challan_id", id),
        supabase.from("goods_receipt_notes").select("id,grn_number,status,received_date,goods_receipt_items(challan_item_id,received_quantity,accepted_quantity,damaged_quantity,rejected_quantity)").eq("challan_id", id).order("created_at"),
      ]);
      if (header.error) throw header.error;
      if (lines.error) throw lines.error;
      if (receipts.error) throw receipts.error;
      return { header: header.data, lines: lines.data ?? [], receipts: receipts.data ?? [] };
    },
  });
  const cancel = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error("Enter a cancellation reason.");
      const { error } = await supabase.rpc("cancel_vendor_delivery_challan", { _id: id, _reason: reason.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Delivery challan cancelled");
      setCancelOpen(false);
      setReason("");
      qc.invalidateQueries({ queryKey: ["vendor-delivery-challan", id] });
      qc.invalidateQueries({ queryKey: ["vendor-delivery-challans"] });
      qc.invalidateQueries({ queryKey: ["po"] });
    },
    onError: error => toast.error(errMsg(error)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <p className="text-sm text-destructive">{errMsg(q.error)}</p>;
  if (!q.data) return null;

  const { header: h, lines, receipts } = q.data;
  const liveReceipts = receipts.filter(r => r.status !== "cancelled");
  const canCancel = h.status === "registered" && liveReceipts.length === 0 && can("grn.create");
  const receivedByLine = new Map<string, number>();
  for (const r of liveReceipts) {
    for (const line of r.goods_receipt_items ?? []) {
      if (line.challan_item_id) receivedByLine.set(line.challan_item_id, (receivedByLine.get(line.challan_item_id) ?? 0) + Number(line.received_quantity));
    }
  }
  const qty = lines.reduce((sum, x) => sum + Number(x.quantity), 0);
  const received = lines.reduce((sum, x) => sum + (receivedByLine.get(x.id) ?? 0), 0);

  return <div className="mx-auto max-w-5xl pb-20">
    <PageHeader title={h.challan_number}
      subtitle={<span>Vendor Delivery Challan · <span className={h.status === "registered" ? "font-semibold text-green-700 dark:text-green-400" : "font-semibold text-destructive"}>{h.status === "registered" ? "Registered" : "Cancelled"}</span></span>}
      crumbs={<Link to="/inventory/delivery-challans" search={{ po: null }} className="hover:underline">Delivery Challans</Link>}
      actions={canCancel && <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>Cancel challan</Button>} />
    <section className="grid gap-4 rounded-xl border bg-card p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div><p className="text-xs text-muted-foreground">Supplier</p><p className="font-semibold">{h.vendors?.company_name}</p></div>
      <div><p className="text-xs text-muted-foreground">Purchase order</p><Link className="font-semibold text-primary hover:underline" to="/procurement/purchase-orders/$id" params={{ id: h.po_id }}>{h.purchase_orders?.po_number}</Link></div>
      <div><p className="text-xs text-muted-foreground">Challan date</p><p className="font-semibold">{fmtDate(h.challan_date)}</p></div>
      <div><p className="text-xs text-muted-foreground">Project</p><p className="font-semibold">{h.projects?.name}{h.buildings?.name ? ` · ${h.buildings.name}` : ""}</p></div>
      <div><p className="text-xs text-muted-foreground">Vehicle</p><p>{h.vehicle_number || "—"}</p></div>
      <div><p className="text-xs text-muted-foreground">Supplier invoice reference</p><p>{h.invoice_reference || "—"}</p></div>
      <div><p className="text-xs text-muted-foreground">Registered by</p><p>{h.profiles?.full_name || "Authorised staff"}</p></div>
      <div><p className="text-xs text-muted-foreground">Registered at</p><p>{fmtDateTime(h.created_at)}</p></div>
      {h.remarks && <div className="sm:col-span-2 lg:col-span-4"><p className="text-xs text-muted-foreground">Remarks</p><p className="whitespace-pre-wrap">{h.remarks}</p></div>}
    </section>
    <section className="mt-5 rounded-xl border bg-card p-5">
      <div className="mb-3 flex flex-wrap justify-between gap-3"><h2 className="font-semibold">Dispatched vs received quantities</h2><div className="text-xs text-muted-foreground">{num(received)} of {num(qty)} recorded as physically received</div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[580px] text-sm">
        <thead className="border-b bg-muted/30 text-left text-xs"><tr><th className="p-2">Material</th><th className="p-2 text-right">Dispatched</th><th className="p-2 text-right">GRN received</th><th className="p-2 text-right">Remaining on challan</th></tr></thead>
        <tbody>{lines.map(x => { const got = receivedByLine.get(x.id) ?? 0; return <tr key={x.id} className="border-b last:border-0">
          <td className="p-2">{x.purchase_order_items?.items?.name} <span className="text-xs text-muted-foreground">{x.purchase_order_items?.items?.code}</span></td>
          <td className="p-2 text-right tabular-nums">{num(x.quantity)} {x.purchase_order_items?.units_of_measure?.code}</td>
          <td className="p-2 text-right tabular-nums">{num(got)}</td>
          <td className="p-2 text-right tabular-nums">{num(Math.max(0, Number(x.quantity) - got))}</td>
        </tr>; })}</tbody>
      </table></div>
    </section>
    <section className="mt-5 rounded-xl border bg-card p-5">
      <h2 className="mb-3 font-semibold">Linked goods receipts</h2>
      {receipts.length === 0 ? <p className="text-sm text-muted-foreground">No GRN has been recorded against this challan yet.</p> :
        <ul className="space-y-2 text-sm">{receipts.map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
          <Link to="/inventory/goods-received/$id" params={{ id: r.id }} className="font-medium text-primary hover:underline">{r.grn_number}</Link>
          <span className="text-xs text-muted-foreground">{fmtDate(r.received_date)} · {r.status}</span>
        </li>)}</ul>}
      <p className="mt-4 text-xs text-muted-foreground">Only accepted quantities from posted GRNs enter the stock ledger. Registering a challan itself never increases stock.</p>
    </section>
    {h.status === "cancelled" && <p className="mt-4 rounded-md border p-3 text-sm text-destructive">Cancelled: {h.cancel_reason || "No reason available"}</p>}
    <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
      <DialogContent><DialogHeader><DialogTitle>Cancel supplier challan</DialogTitle><DialogDescription>This action is audited and is blocked while an active GRN is linked to this challan.</DialogDescription></DialogHeader>
        <Textarea placeholder="Required cancellation reason" value={reason} onChange={event => setReason(event.target.value)} />
        <DialogFooter><Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button><Button variant="destructive" disabled={cancel.isPending || !reason.trim()} onClick={() => cancel.mutate()}>Confirm cancellation</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
