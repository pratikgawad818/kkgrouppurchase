import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Loading, PageHeader } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, fmtDate, inr } from "@/lib/format";
import { selectCls } from "@/lib/po";
import { PAGE } from "@/lib/fy";
import { useCan, useMe } from "@/lib/session";
import { badge, openVendorDoc, PAYMENT_MODES, PAYMENT_STATUS, today, uploadVendorDoc, type PaymentKind } from "@/lib/finance";
import { cn } from "@/lib/utils";
import { availableAfterScheduled, inspectPaymentSchedule } from "@/lib/payment-preflight";

const META = "Schedule, approve and record vendor payments and advances.";
export const Route = createFileRoute("/_authenticated/_shell/finance/payments")({
  head: () => ({ meta: [{ title: "Vendor Payments — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Vendor Payments — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (s: Record<string, unknown>): { vendor?: string } => (typeof s["vendor"] === "string" ? { vendor: s["vendor"] as string } : {}),
  component: Payments,
});

function Payments() {
  const sp = Route.useSearch();
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("");
  const [schedule, setSchedule] = useState<PaymentKind | null>(sp.vendor ? "invoice" : null);
  const [act, setAct] = useState<null | { id: string; action: "approve" | "record" | "cancel" }>(null);
  const [adjust, setAdjust] = useState<null | { id: string; vendor_id: string; left: number }>(null);
  const q = useQuery({
    queryKey: ["vendor-payments"],
    queryFn: async () => {
      const [p, a] = await Promise.all([
        supabase.from("vendor_payments").select("*, vendors(company_name), company_bank_accounts(account_name), vendor_payment_allocations(amount, vendor_invoices(invoice_number))").order("created_at", { ascending: false }).limit(2000),
        supabase.from("vendor_advance_adjustments").select("advance_payment_id, amount"),
      ]);
      if (p.error) throw p.error;
      const used = new Map<string, number>();
      for (const x of a.data ?? []) used.set(x.advance_payment_id, (used.get(x.advance_payment_id) ?? 0) + Number(x.amount));
      return { rows: p.data ?? [], used };
    },
  });
  const refresh = () => { ["vendor-payments", "payables", "vendor-invoices", "vi", "ledger"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const rows = (q.data?.rows ?? []).filter((x) => !status || x.status === status);
  const pageRows = rows.slice(page * PAGE, (page + 1) * PAGE);
  return (
    <>
      <PageHeader title="Vendor Payments" subtitle="Scheduled → Approved (Director) → Recorded with bank reference. Only recorded payments reduce payables."
        actions={can("payment.schedule") && <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => setSchedule("invoice")}><Plus className="mr-1 h-4 w-4" />Pay invoices</Button><Button size="sm" variant="outline" onClick={() => setSchedule("advance")}>Vendor advance</Button></div>} />
      <div className="mb-3"><select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-44 sm:flex-none")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">All statuses</option>{Object.entries(PAYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
      {q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : (<>
        <div className="doc-table overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap"><table className="w-full text-sm">
          <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Number</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">Against</th><th className="px-4 py-3">Mode / ref</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {pageRows.length === 0 && <tr><td colSpan={9} className="p-4 text-xs text-muted-foreground">No payments yet.</td></tr>}
            {pageRows.map((p) => {
              const mine = p.created_by === me.data?.profile.id;
              const left = Number(p.amount) - (q.data?.used.get(p.id) ?? 0);
              return (
                <tr key={p.id} className="border-b last:border-0 align-top">
                  <td className="px-4 py-3 font-medium tabular-nums">{p.payment_number}</td><td className="px-4 py-3">{p.kind === "advance" ? "Advance" : "Invoice"}</td><td className="px-4 py-3">{fmtDate(p.payment_date)}</td>
                  <td className="px-4 py-3">{p.vendors?.company_name}</td>
                  <td className="px-4 py-3 text-xs">{p.kind === "advance" ? <>{p.remarks}{p.status === "recorded" && <div className="text-muted-foreground">Unadjusted {inr(left)}</div>}</> : p.vendor_payment_allocations.map((a, i) => <div key={i} className="font-mono">{a.vendor_invoices?.invoice_number} · {inr(a.amount)}</div>)}</td>
                  <td className="px-4 py-3 text-xs">{PAYMENT_MODES.find((m) => m[0] === p.payment_mode)?.[1]} {p.reference ?? ""}<div className="text-muted-foreground">{p.company_bank_accounts?.account_name}</div>{p.proof_path && <button className="text-primary hover:underline" onClick={() => openVendorDoc(p.proof_path!).catch((e) => toast.error(errMsg(e)))}>Proof</button>}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{inr(p.amount)}</td>
                  <td className="px-4 py-3"><span className={cn(badge, PAYMENT_STATUS[p.status].cls)}>{PAYMENT_STATUS[p.status].label}</span></td>
                  <td className="px-4 py-3"><div className="flex flex-wrap justify-end gap-1">
                    {p.status === "scheduled" && can("payment.approve") && !mine && <Button size="sm" variant="outline" onClick={() => setAct({ id: p.id, action: "approve" })}>Approve</Button>}
                    {p.status === "approved" && can("payment.record") && <Button size="sm" onClick={() => setAct({ id: p.id, action: "record" })}>Record payment</Button>}
                    {(p.status === "scheduled" || p.status === "approved") && (can("payment.schedule") || can("payment.approve")) && <Button size="sm" variant="ghost" onClick={() => setAct({ id: p.id, action: "cancel" })}>Cancel</Button>}
                    {p.kind === "advance" && p.status === "recorded" && left > 0 && can("payment.record") && <Button size="sm" variant="outline" onClick={() => setAdjust({ id: p.id, vendor_id: p.vendor_id, left })}>Adjust against invoice</Button>}
                  </div></td>
                </tr>);
            })}
          </tbody>
        </table></div>
        <Pager page={page} total={rows.length} size={PAGE} onPage={setPage} />
      </>)}
      {schedule && <ScheduleDialog kind={schedule} initialVendor={sp.vendor} onClose={() => setSchedule(null)} onDone={refresh} />}
      {act && <ActDialog {...act} onClose={() => setAct(null)} onDone={refresh} />}
      {adjust && <AdjustDialog {...adjust} onClose={() => setAdjust(null)} onDone={refresh} />}
    </>
  );
}

function ScheduleDialog({ kind, initialVendor, onClose, onDone }: { kind: PaymentKind; initialVendor?: string | undefined; onClose: () => void; onDone: () => void }) {
  const [vendor, setVendor] = useState(initialVendor ?? "");
  const [h, setH] = useState({ payment_date: today(), payment_mode: "neft", bank_account_id: "", reference: "", remarks: "", amount: "", project_id: "" });
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const base = useQuery({
    queryKey: ["pay-base"],
    queryFn: async () => {
      const [v, b, p] = await Promise.all([
        supabase.from("vendors").select("id,company_name").eq("status", "active").order("company_name"),
        supabase.from("company_bank_accounts").select("id,account_name,bank_name").eq("status", "active"),
        supabase.from("projects").select("id,name").order("name"),
      ]);
      return { vendors: v.data ?? [], banks: b.data ?? [], projects: p.data ?? [] };
    },
  });
  const inv = useQuery({
    queryKey: ["pay-open", vendor], enabled: kind === "invoice" && !!vendor,
    queryFn: async () => {
      const [i, a] = await Promise.all([
        supabase.from("vendor_invoices").select("id,invoice_number,vendor_invoice_number,due_date,balance_due,project_id").eq("vendor_id", vendor).in("status", ["approved", "partially_paid"]).order("due_date").limit(1001),
        supabase.from("vendor_payment_allocations").select("invoice_id,amount,vendor_payments!inner(status)").in("vendor_payments.status", ["scheduled", "approved"]).limit(1001),
      ]);
      if (i.error) throw i.error;
      if (a.error) throw a.error;
      if ((i.data?.length ?? 0) > 1000 || (a.data?.length ?? 0) > 1000) {
        throw new Error("Payment availability exceeds the current 1,000-row verification limit. Ask Accounts to review the complete payment register before scheduling.");
      }
      const pending = new Map<string, number>();
      for (const x of a.data ?? []) pending.set(x.invoice_id, (pending.get(x.invoice_id) ?? 0) + Number(x.amount));
      return (i.data ?? []).map((x) => {
        const payable = availableAfterScheduled(Number(x.balance_due), pending.get(x.id) ?? 0);
        if (payable === null) throw new Error(`Cannot determine the available balance for invoice ${x.invoice_number}.`);
        return { ...x, payable };
      });
    },
  });
  useEffect(() => { setAlloc({}); }, [vendor]);
  const invoicePreflight = inspectPaymentSchedule(alloc, inv.data ?? [],
    kind === "invoice" && !!vendor && inv.isSuccess && !inv.isFetching && !inv.error);
  const advanceAmount = h.amount.trim();
  const validAdvance = /^\d+(?:\.\d{1,2})?$/.test(advanceAmount) &&
    Number(advanceAmount) > 0 && Number.isFinite(Number(advanceAmount)) &&
    !!h.remarks.trim();
  const total = kind === "advance" ? (validAdvance ? Number(advanceAmount) : 0) : invoicePreflight.total;
  const canSchedule = !!vendor && !base.isLoading && !base.error &&
    (kind === "advance" ? validAdvance : invoicePreflight.errors.length === 0);
  const save = useMutation({
    mutationFn: async () => {
      if (!vendor || base.isLoading || base.error) throw new Error("Vendor information is not available. Refresh before scheduling.");
      if (kind === "advance" && !validAdvance) throw new Error("Enter a positive advance amount (up to two decimals) and a purpose.");
      if (kind === "invoice" && invoicePreflight.errors.length) throw new Error(invoicePreflight.errors.join(" "));
      const { error } = await supabase.rpc("schedule_vendor_payment", {
        _header: { kind, vendor_id: vendor, ...h },
        _allocations: kind === "invoice" ? invoicePreflight.allocations : [],
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Payment scheduled"); onDone(); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{kind === "advance" ? "Schedule vendor advance" : "Schedule invoice payment"}</DialogTitle><DialogDescription>A Director approves it before it can be recorded as paid.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor"><select className={selectCls} value={vendor} onChange={(e) => setVendor(e.target.value)}><option value="">Select vendor</option>{base.data?.vendors.map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}</select></Field>
          <Field label="Planned payment date"><Input type="date" value={h.payment_date} onChange={(e) => setH({ ...h, payment_date: e.target.value })} /></Field>
          <Field label="Mode"><select className={selectCls} value={h.payment_mode} onChange={(e) => setH({ ...h, payment_mode: e.target.value })}>{PAYMENT_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Pay from bank account"><select className={selectCls} value={h.bank_account_id} onChange={(e) => setH({ ...h, bank_account_id: e.target.value })}><option value="">—</option>{base.data?.banks.map((b) => <option key={b.id} value={b.id}>{b.account_name} · {b.bank_name}</option>)}</select></Field>
          {kind === "advance" && <>
            <Field label="Advance amount"><Input type="number" min={0} value={h.amount} onChange={(e) => setH({ ...h, amount: e.target.value })} /></Field>
            <Field label="Project (optional)"><select className={selectCls} value={h.project_id} onChange={(e) => setH({ ...h, project_id: e.target.value })}><option value="">—</option>{base.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          </>}
        </div>
        {base.error && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">Vendor/bank details could not be loaded: {errMsg(base.error)}</p>}
        {kind === "invoice" && vendor && (inv.isLoading ? <Loading /> : inv.error ? (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <p>Invoice balances or pending payment reservations could not be verified: {errMsg(inv.error)}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => inv.refetch()}>Retry availability check</Button>
          </div>
        ) : (
          <div className="doc-table max-h-64 overflow-auto rounded-md border max-sm:max-h-[55vh]"><table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Due</th><th className="px-4 py-3 text-right">Payable now</th><th className="px-4 py-3 text-right">Pay</th></tr></thead>
            <tbody>
              {(inv.data ?? []).length === 0 && <tr><td colSpan={4} className="p-3 text-xs text-muted-foreground">No approved unpaid invoices for this vendor.</td></tr>}
              {inv.data?.map((x) => <tr key={x.id} className="border-t"><td className="px-4 py-3 font-medium tabular-nums text-xs">{x.invoice_number}<div className="text-muted-foreground">{x.vendor_invoice_number}</div></td><td className="px-4 py-3">{fmtDate(x.due_date)}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{inr(x.payable)}</td>
                <td className="px-4 py-3"><div className="flex items-center justify-end gap-1"><Input className="h-8 w-28 text-right" type="number" min={0} max={x.payable} value={alloc[x.id] ?? ""} onChange={(e) => setAlloc({ ...alloc, [x.id]: e.target.value })} /><Button size="sm" variant="ghost" onClick={() => setAlloc({ ...alloc, [x.id]: String(x.payable) })}>Full</Button></div></td></tr>)}
            </tbody>
          </table></div>
        ))}
        {kind === "invoice" && vendor && !inv.isLoading && !inv.error && invoicePreflight.errors.length > 0 && Object.values(alloc).some(v => v.trim()) &&
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {invoicePreflight.errors.map((message, i) => <p key={i}>{message}</p>)}
          </div>}
        <Field label={kind === "advance" ? "Purpose (required)" : "Remarks"}><Textarea rows={2} value={h.remarks} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></Field>
        <DialogFooter><span className="mr-auto text-sm">Total <span className="font-mono font-semibold">{inr(total)}</span></span><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={!canSchedule || total <= 0 || save.isPending} onClick={() => save.mutate()}>Schedule</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActDialog({ id, action, onClose, onDone }: { id: string; action: "approve" | "record" | "cancel"; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState("");
  const [d, setD] = useState({ payment_date: today(), reference: "" });
  const [file, setFile] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      const proof_path = file ? await uploadVendorDoc("payments", file) : "";
      const { error } = await supabase.rpc("payment_transition", { _id: id, _action: action, _comment: comment, _details: { ...d, proof_path } });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Done"); onDone(); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const title = action === "approve" ? "Approve payment" : action === "record" ? "Record payment" : "Cancel payment";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{action === "record" ? "Recording reduces the vendor's outstanding and the bank balance." : "Recorded in the payment history."}</DialogDescription></DialogHeader>
        {action === "record" && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Actual payment date"><Input type="date" value={d.payment_date} onChange={(e) => setD({ ...d, payment_date: e.target.value })} /></Field>
          <Field label="UTR / cheque / reference"><Input value={d.reference} onChange={(e) => setD({ ...d, reference: e.target.value })} /></Field>
          <Field label="Payment proof (optional)" className="sm:col-span-2"><Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        </div>}
        <Textarea rows={2} placeholder={action === "cancel" ? "Reason (required)" : "Comment (optional)"} value={comment} onChange={(e) => setComment(e.target.value)} />
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={m.isPending || (action === "cancel" && !comment.trim()) || (action === "record" && !d.reference.trim())} onClick={() => m.mutate()}>Confirm</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ id, vendor_id, left, onClose, onDone }: { id: string; vendor_id: string; left: number; onClose: () => void; onDone: () => void }) {
  const [invoice, setInvoice] = useState("");
  const [amount, setAmount] = useState("");
  const inv = useQuery({
    queryKey: ["adj-open", vendor_id],
    queryFn: async () => (await supabase.from("vendor_invoices").select("id,invoice_number,balance_due").eq("vendor_id", vendor_id).in("status", ["approved", "partially_paid"])).data ?? [],
  });
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("apply_vendor_advance", { _advance_id: id, _invoice_id: invoice, _amount: Number(amount) }); if (error) throw error; },
    onSuccess: () => { toast.success("Advance adjusted"); onDone(); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Adjust advance against invoice</DialogTitle><DialogDescription>Unadjusted advance: {inr(left)}</DialogDescription></DialogHeader>
        <Field label="Invoice"><select className={selectCls} value={invoice} onChange={(e) => setInvoice(e.target.value)}><option value="">Select</option>{inv.data?.map((x) => <option key={x.id} value={x.id}>{x.invoice_number} · balance {inr(x.balance_due)}</option>)}</select></Field>
        <Field label="Amount"><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={!invoice || !(Number(amount) > 0) || m.isPending} onClick={() => m.mutate()}>Adjust</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
