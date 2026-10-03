import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Loading, PageHeader } from "@/components/erp/common";
import { errMsg, fmtDate, fmtDateTime, inr, num } from "@/lib/format";
import { useCan } from "@/lib/session";
import { loadRfq } from "@/lib/rfq-data";
import { QUOTATION_STATUS, RFQ_STATUS, RFQ_VENDOR_STATUS } from "@/lib/rfq";

export const Route = createFileRoute("/_authenticated/_shell/procurement/rfqs/$id/")({
  head: () => ({ meta: [{ title: "RFQ — KK GROUP ERP" }, { name: "description", content: "RFQ details, vendor responses and selection." }, { property: "og:title", content: "RFQ — KK GROUP ERP" }, { property: "og:description", content: "RFQ details, vendor responses and selection." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: RfqDetail,
});

function RfqDetail() {
  const { id } = Route.useParams();
  const can = useCan();
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["rfq", id], queryFn: () => loadRfq(id) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["rfq", id] }); qc.invalidateQueries({ queryKey: ["rfqs"] }); };

  const act = useMutation({
    mutationFn: async (a: "send" | "cancel") => {
      const { error } = await supabase.rpc("rfq_transition", { _rfq_id: id, _action: a, ...(a === "cancel" ? { _comment: reason.trim() } : {}) });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Updated"); setCancelOpen(false); setReason(""); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const decline = useMutation({
    mutationFn: async (rvId: string) => { const { error } = await supabase.rpc("rfq_mark_vendor_declined", { _rfq_vendor_id: rvId }); if (error) throw error; },
    onSuccess: () => { toast.success("Marked as declined"); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const removeVendor = useMutation({
    mutationFn: async (rvId: string) => { const { error } = await supabase.from("rfq_vendors").delete().eq("id", rvId); if (error) throw error; },
    onSuccess: refresh, onError: (e) => toast.error(errMsg(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="text-sm text-destructive">{errMsg(q.error)}</div>;
  const { rfq, items, vendors, quotes, selections } = q.data!;
  const st = RFQ_STATUS[rfq.status];
  const open = ["sent", "partially_responded", "fully_responded"].includes(rfq.status);
  const responded = ["partially_responded", "fully_responded", "ready_for_po"].includes(rfq.status);

  return (
    <>
      <PageHeader
        crumbs={<Link to="/procurement/rfqs">RFQs</Link>}
        title={rfq.rfq_number}
        subtitle={<span className={`inline-flex rounded-sm border px-1.5 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>}
        actions={<>
          {rfq.status === "draft" && can("rfq.send") && <Button size="sm" disabled={act.isPending} onClick={() => act.mutate("send")}>Mark as sent</Button>}
          {responded && can("quotation.compare") && <Button asChild size="sm" variant="outline"><Link to="/procurement/rfqs/$id/compare" params={{ id }}>Compare quotations</Link></Button>}
          {!["ready_for_po", "closed", "cancelled"].includes(rfq.status) && can("rfq.cancel") && <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)}>Cancel RFQ</Button>}
        </>}
      />
      <section className="rounded-md border bg-card p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Purchase request">{rfq.purchase_requests && <Link className="text-primary hover:underline" to="/procurement/purchase-requests/$id" params={{ id: rfq.purchase_requests.id }}>{rfq.purchase_requests.pr_number}</Link>}</Field>
          <Field label="Project">{rfq.projects ? `${rfq.projects.code} · ${rfq.projects.name}` : null}</Field>
          <Field label="Building">{rfq.buildings?.name}</Field>
          <Field label="RFQ date">{fmtDate(rfq.rfq_date)}</Field>
          <Field label="Response due">{fmtDate(rfq.response_due_date)}</Field>
          <Field label="Required by">{fmtDate(rfq.required_by_date)}</Field>
          <Field label="Sent">{rfq.sent_at ? fmtDateTime(rfq.sent_at) : null}</Field>
          <Field label="Remarks" className="sm:col-span-2 whitespace-pre-line">{rfq.remarks}</Field>
        </div>
        {rfq.status === "draft" && <p className="mt-3 text-xs text-muted-foreground">Share the RFQ with the vendors (email/phone), then click “Mark as sent” to start recording quotations.</p>}
      </section>

      <section className="mt-4 overflow-x-auto rounded-md border bg-card">
        <h2 className="p-3 text-sm font-semibold">Items</h2>
        <table className="w-full text-sm">
          <thead className="border-y bg-muted/40 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="p-2">#</th><th className="p-2">Material</th><th className="p-2 text-right">Qty</th><th className="p-2">Unit</th><th className="p-2 text-right">Target rate</th><th className="p-2">Awarded to</th></tr></thead>
          <tbody>{items.map((x) => { const s = selections.find((y) => y.rfq_item_id === x.id); return (
            <tr key={x.id} className="border-b last:border-0"><td className="p-2">{x.line_no}</td><td className="p-2">{x.items?.name} <span className="text-xs text-muted-foreground">{x.items?.code}</span></td><td className="p-2 text-right font-mono">{num(x.requested_quantity)}</td><td className="p-2">{x.units_of_measure?.code}</td><td className="p-2 text-right font-mono">{x.target_rate == null ? "—" : inr(x.target_rate)}</td><td className="p-2">{s ? `${s.vendors?.company_name} @ ${inr(s.awarded_rate)}` : "—"}</td></tr>
          ); })}</tbody>
        </table>
      </section>

      <section className="mt-4 overflow-x-auto rounded-md border bg-card">
        <h2 className="p-3 text-sm font-semibold">Vendor responses</h2>
        <table className="w-full text-sm">
          <thead className="border-y bg-muted/40 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="p-2">Vendor</th><th className="p-2">Response</th><th className="p-2">Quote ref</th><th className="p-2">Valid until</th><th className="p-2 text-right">Grand total</th><th className="p-2"></th></tr></thead>
          <tbody>{vendors.map((v) => { const qt = quotes.find((x) => x.rfq_vendor_id === v.id); return (
            <tr key={v.id} className="border-b last:border-0">
              <td className="p-2"><div className="font-medium">{v.vendors?.company_name}</div><div className="text-xs text-muted-foreground">{[v.vendors?.contact_person, v.vendors?.mobile, v.vendors?.email].filter(Boolean).join(" · ")}</div></td>
              <td className="p-2">{RFQ_VENDOR_STATUS[v.status]}{qt ? ` · ${QUOTATION_STATUS[qt.status]}` : ""}</td>
              <td className="p-2 font-mono text-xs">{qt?.quotation_number ?? "—"}</td>
              <td className="p-2">{qt ? fmtDate(qt.valid_until) : "—"}</td>
              <td className="p-2 text-right font-mono">{qt ? inr(qt.grand_total) : "—"}</td>
              <td className="p-2 text-right whitespace-nowrap">
                {rfq.status === "draft" && can("rfq.edit") && <Button size="sm" variant="ghost" onClick={() => removeVendor.mutate(v.id)}>Remove</Button>}
                {open && can("quotation.create") && (!qt || ["draft", "submitted"].includes(qt.status)) && v.status !== "declined" && <Button asChild size="sm" variant="outline"><Link to="/procurement/rfqs/$id/quotation" params={{ id }} search={{ vendor: v.id }}>{qt ? "Edit quote" : "Enter quote"}</Link></Button>}
                {open && can("quotation.create") && v.status === "pending" && <Button size="sm" variant="ghost" onClick={() => decline.mutate(v.id)}>Declined</Button>}
              </td>
            </tr>
          ); })}</tbody>
        </table>
      </section>

      {rfq.status === "ready_for_po" && (
        <section className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-4 text-sm">
          <div className="font-semibold">Ready for Purchase Order</div>
          <div className="mt-1 text-muted-foreground">Selection reason: {rfq.selection_reason}</div>
          <AwardPos rfqId={id} quotes={quotes.filter((x) => x.status === "selected")} canCreate={can("purchase_order.create")} />
        </section>
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel RFQ</DialogTitle><DialogDescription>A reason is required and is recorded permanently.</DialogDescription></DialogHeader>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter><Button variant="outline" onClick={() => setCancelOpen(false)}>Close</Button><Button variant="destructive" disabled={!reason.trim() || act.isPending} onClick={() => act.mutate("cancel")}>Cancel RFQ</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
