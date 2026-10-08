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
import { useCan, useMe } from "@/lib/session";
import { badge, INVOICE_STATUS, MATCH_STATUS, openVendorDoc } from "@/lib/finance";
import { cn } from "@/lib/utils";

const META = "Vendor invoice details, three-way match and approval history.";
export const Route = createFileRoute("/_authenticated/_shell/finance/vendor-invoices/$id")({
  head: () => ({ meta: [{ title: "Vendor Invoice — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Vendor Invoice — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: InvoiceDetail,
});

type Act = "submit" | "approve" | "approve_exception" | "reject" | "cancel";
const ACT_LABEL: Record<string, string> = { created: "Created", edited: "Edited", submit: "Matched / submitted", approve: "Approved", approve_exception: "Exception approved", reject: "Rejected", cancel: "Cancelled" };

function InvoiceDetail() {
  const { id } = Route.useParams();
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<Act | null>(null);
  const [comment, setComment] = useState("");
  const q = useQuery({
    queryKey: ["vi", id],
    queryFn: async () => {
      const [i, it, ev, pay, adj] = await Promise.all([
        supabase.from("vendor_invoices").select("*, vendors(company_name,gstin,address,city,state,contact_person,mobile,email), projects(name), buildings(name), purchase_orders(po_number,po_date,grand_total), profiles!vendor_invoices_created_by_fkey(full_name)").eq("id", id).single(),
        supabase.from("vendor_invoice_items").select("*, items(code,name), goods_receipt_notes(grn_number)").eq("invoice_id", id).order("line_no"),
        supabase.from("vendor_invoice_events").select("*, profiles(full_name)").eq("invoice_id", id).order("acted_at"),
        supabase.from("vendor_payment_allocations").select("amount, vendor_payments(id,payment_number,payment_date,status,reference)").eq("invoice_id", id),
        supabase.from("vendor_advance_adjustments").select("amount,created_at,vendor_payments(payment_number)").eq("invoice_id", id),
      ]);
      if (i.error) throw i.error;
      return { inv: i.data, items: it.data ?? [], events: ev.data ?? [], payments: pay.data ?? [], adjustments: adj.data ?? [] };
    },
  });
  const act = useMutation({
    mutationFn: async (a: Act) => { const { error } = await supabase.rpc("invoice_transition", { _id: id, _action: a, _comment: comment }); if (error) throw error; },
    onSuccess: () => { toast.success("Done"); setDlg(null); setComment(""); qc.invalidateQueries({ queryKey: ["vi", id] }); qc.invalidateQueries({ queryKey: ["vendor-invoices"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <div className="text-sm text-destructive">{errMsg(q.error)}</div>;
  const { inv, items, events, payments, adjustments } = q.data;
  const mine = inv.created_by === me.data?.profile.id;
  const ms = inv.match_summary as null | { qty_variances: number; rate_variances: number; tax_variances: number; expected_total: number; invoice_total: number; total_variance: number; matched_at?: string; exceptions?: { message: string }[]; tolerances: { qty_pct: number; rate_pct: number; value: number; source?: string } };
  const needsComment = dlg === "reject" || dlg === "cancel" || dlg === "approve_exception";
  const editable = inv.status === "draft" || inv.status === "exception";
  return (
    <>
      <PageHeader title={inv.invoice_number} subtitle={<span className="flex flex-wrap items-center gap-2">Bill {inv.vendor_invoice_number} · {inv.vendors?.company_name}<span className={cn(badge, INVOICE_STATUS[inv.status].cls)}>{INVOICE_STATUS[inv.status].label}</span><span className={cn(badge, MATCH_STATUS[inv.match_status].cls)}>{MATCH_STATUS[inv.match_status].label}</span></span>}
        actions={<div className="flex flex-wrap gap-2">
          {inv.attachment_path && <><Button size="sm" variant="outline" onClick={() => openVendorDoc(inv.attachment_path!).catch((e) => toast.error(errMsg(e)))}>View invoice</Button><Button size="sm" variant="outline" onClick={() => openVendorDoc(inv.attachment_path!, true).catch((e) => toast.error(errMsg(e)))}>Download invoice</Button></>}
          {editable && can("vendor_invoice.create") && <Button size="sm" variant="outline" asChild><Link to="/finance/vendor-invoices/new" search={{ id }}>{inv.status === "exception" ? "Resolve (edit)" : "Edit"}</Link></Button>}
          {editable && (can("vendor_invoice.create") || can("vendor_invoice.review")) && <Button size="sm" onClick={() => act.mutate("submit")} disabled={act.isPending}>Run 3-way match</Button>}
          {inv.status === "pending_review" && can("vendor_invoice.approve") && !mine && <Button size="sm" onClick={() => setDlg("approve")}>Approve</Button>}
          {inv.status === "exception" && can("vendor_invoice.approve_exception") && !mine && <Button size="sm" onClick={() => setDlg("approve_exception")}>Approve exception</Button>}
          {(inv.status === "pending_review" || inv.status === "exception") && (can("vendor_invoice.approve") || can("vendor_invoice.approve_exception")) && <Button size="sm" variant="destructive" onClick={() => setDlg("reject")}>Reject</Button>}
          {["draft", "exception", "rejected"].includes(inv.status) && can("vendor_invoice.create") && <Button size="sm" variant="ghost" onClick={() => setDlg("cancel")}>Cancel</Button>}
          {["approved", "partially_paid"].includes(inv.status) && can("payment.schedule") && <Button size="sm" asChild><Link to="/finance/payments" search={{ vendor: inv.vendor_id }}>Schedule payment</Link></Button>}
        </div>} />
      {mine && (inv.status === "pending_review" || inv.status === "exception") && <p className="mb-3 text-xs text-muted-foreground">You entered this invoice, so another authorised user must approve it.</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-md border bg-card p-4 text-sm">
          <div className="font-medium">{inv.vendors?.company_name}</div>
          <div className="text-xs text-muted-foreground">GSTIN {inv.vendors?.gstin ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{[inv.vendors?.address, inv.vendors?.city, inv.vendors?.state].filter(Boolean).join(", ")}</div>
          <div className="mt-3 space-y-0.5 border-t pt-2 text-xs">
            <div>PO <Link className="font-mono text-primary hover:underline" to="/procurement/purchase-orders/$id" params={{ id: inv.po_id }}>{inv.purchase_orders?.po_number}</Link> · {inr(inv.purchase_orders?.grand_total)}</div>
            <div>{inv.projects?.name}{inv.buildings?.name ? ` · ${inv.buildings.name}` : ""}</div>
            <div>Bill date {fmtDate(inv.vendor_invoice_date)} · Due {fmtDate(inv.due_date)}</div>
            <div>Entered by {inv.profiles?.full_name ?? "—"}</div>
          </div>
        </div>
        <div className="rounded-md border bg-card p-4 text-sm">
          {[["Taxable value", inv.subtotal], ["CGST", inv.cgst], ["SGST", inv.sgst], ["IGST", inv.igst], ["Freight", inv.freight], ["Other charges", inv.other_charges], ["Gross invoice amount", inv.grand_total], [`TDS ${inv.tds_section ?? ""} ${Number(inv.tds_rate) ? `(${inv.tds_rate}%)` : ""}`, -Number(inv.tds_amount)]].map(([k, v]) => <div key={k as string} className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="font-mono">{inr(v as number)}</span></div>)}
          <div className="flex justify-between border-t pt-1 font-semibold"><span>Net payable</span><span className="font-mono">{inr(inv.net_payable)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="font-mono">{inr(inv.amount_paid)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Advance adjusted</span><span className="font-mono">{inr(inv.advance_adjusted)}</span></div>
          <div className="flex justify-between font-semibold"><span>Balance due</span><span className="font-mono">{inv.status === "rejected" || inv.status === "cancelled" ? inr(0) : inr(inv.balance_due)}</span></div>
        </div>
        <div className="rounded-md border bg-card p-4 text-sm">
          <div className="mb-2 font-medium">Three-way match</div>
          {!ms ? <p className="text-xs text-muted-foreground">Run the match to compare this bill with the PO and goods received.</p> : (<div className="space-y-1 text-xs">
            <div className="flex justify-between"><span>Quantity variances</span><span>{ms.qty_variances}</span></div>
            <div className="flex justify-between"><span>Rate variances</span><span>{ms.rate_variances}</span></div>
            <div className="flex justify-between"><span>Tax variances</span><span>{ms.tax_variances}</span></div>
            <div className="flex justify-between"><span>Expected (PO rate × qty + tax)</span><span className="font-mono">{inr(ms.expected_total)}</span></div>
            <div className="flex justify-between"><span>Billed (lines + tax)</span><span className="font-mono">{inr(ms.invoice_total)}</span></div>
            <div className={cn("flex justify-between font-medium", Math.abs(ms.total_variance) > ms.tolerances.value && "text-amber-700")}><span>Total variance</span><span className="font-mono">{inr(ms.total_variance)}</span></div>
            {!!ms.exceptions?.length && <ul className="mt-1 space-y-0.5 rounded-sm border border-destructive/30 bg-destructive/5 p-2 text-destructive">{ms.exceptions.map((x, i) => <li key={i}>{x.message}</li>)}</ul>}
            <div className="mt-1 rounded-sm border bg-muted/40 p-2">
              <div className="font-medium text-foreground">Tolerance used for this match</div>
              <div className="text-muted-foreground">Quantity {ms.tolerances.qty_pct}% · Rate {ms.tolerances.rate_pct}% · Value {inr(ms.tolerances.value)}</div>
              <div className="text-muted-foreground">{ms.tolerances.source ?? "Company Settings → Finance"}{ms.matched_at ? ` · matched ${fmtDateTime(ms.matched_at)}` : ""}</div>
            </div>
          </div>)}
          {inv.status === "exception" && <p className="mt-2 rounded-sm bg-amber-50 p-2 text-xs text-amber-800">Invoice has exceptions. Resolve by editing, approve the exception with a reason, or reject.</p>}
          {(inv.status === "rejected" || inv.status === "cancelled") && <p className="mt-2 rounded-sm border border-destructive/30 bg-destructive/10 p-2 text-xs font-semibold text-destructive">Not Payable — {inv.status === "rejected" ? "Rejected" : "Cancelled"}. Payable balance ₹0.</p>}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">GRN</th><th className="px-4 py-3">Material</th><th className="px-4 py-3 text-right">Invoiced qty</th><th className="px-4 py-3 text-right">Available at GRN</th><th className="px-4 py-3 text-right">PO rate</th><th className="px-4 py-3 text-right">Bill rate</th><th className="px-4 py-3 text-right">PO GST</th><th className="px-4 py-3 text-right">Bill GST</th><th className="px-4 py-3 text-right">Line total</th><th className="px-4 py-3">Match</th></tr></thead>
          <tbody>{items.map((l) => (
            <tr key={l.id} className="border-b last:border-0 hover:bg-muted/40">
              <td className="px-4 py-3">{l.line_no}</td><td className="px-4 py-3 font-medium tabular-nums text-xs">{l.goods_receipt_notes?.grn_number}</td><td className="px-4 py-3">{l.items?.code} · {l.items?.name}</td>
              <td className={cn("p-2 text-right font-mono", Number(l.quantity) > Number(l.available_quantity) && "text-amber-700")}>{num(l.quantity)}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{num(l.available_quantity)}</td>
              <td className="px-4 py-3 text-right font-medium tabular-nums">{inr(l.po_rate)}</td><td className={cn("p-2 text-right font-mono", Number(l.rate) !== Number(l.po_rate) && "text-amber-700")}>{inr(l.rate)}</td>
              <td className="px-4 py-3 text-right">{num(l.po_tax_rate)}%</td><td className={cn("p-2 text-right", Number(l.tax_rate_percent) !== Number(l.po_tax_rate) && "text-amber-700")}>{num(l.tax_rate_percent)}%</td>
              <td className="px-4 py-3 text-right font-medium tabular-nums">{inr(l.line_total)}</td>
              <td className="px-4 py-3 text-xs">{l.match_ok === null ? "—" : l.match_ok ? <span className="text-emerald-700">OK</span> : <span className="text-amber-700">Variance</span>}</td>
            </tr>))}</tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border bg-card p-4">
          <div className="mb-2 text-sm font-medium">Payments</div>
          {payments.length + adjustments.length === 0 ? <p className="text-xs text-muted-foreground">No payments yet.</p> : (<ul className="space-y-1 text-sm">
            {payments.map((p, i) => <li key={i} className="flex justify-between"><span className="font-mono text-xs">{p.vendor_payments?.payment_number} · {fmtDate(p.vendor_payments?.payment_date)} · {p.vendor_payments?.status}</span><span className="font-mono">{inr(p.amount)}</span></li>)}
            {adjustments.map((a, i) => <li key={`a${i}`} className="flex justify-between"><span className="text-xs">Advance {a.vendor_payments?.payment_number} adjusted · {fmtDate(a.created_at)}</span><span className="font-mono">{inr(a.amount)}</span></li>)}
          </ul>)}
        </div>
        <div className="rounded-md border bg-card p-4">
          <div className="mb-2 text-sm font-medium">History</div>
          <ol className="space-y-2 text-sm">{events.map((e) => (
            <li key={e.id} className="border-l-2 border-primary/40 pl-3"><div className="font-medium">{ACT_LABEL[e.action] ?? e.action} <span className="font-normal text-muted-foreground">by {e.profiles?.full_name ?? "—"} · {fmtDateTime(e.acted_at)}</span></div>
              {e.new_status && <div className="text-xs text-muted-foreground">→ {INVOICE_STATUS[e.new_status].label}</div>}{e.comment && <div className="text-xs">“{e.comment}”</div>}</li>))}</ol>
        </div>
      </div>

      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dlg ? ACT_LABEL[dlg] : ""}</DialogTitle><DialogDescription>{dlg === "approve" || dlg === "approve_exception" ? "Approving creates the payable for this vendor and posts it to the accounts." : "This is recorded in the invoice history."}</DialogDescription></DialogHeader>
          <Textarea rows={3} placeholder={needsComment ? "Reason (required)" : "Comment (optional)"} value={comment} onChange={(e) => setComment(e.target.value)} />
          <DialogFooter><Button variant="outline" onClick={() => setDlg(null)}>Close</Button><Button disabled={act.isPending || (needsComment && !comment.trim())} onClick={() => dlg && act.mutate(dlg)}>Confirm</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
