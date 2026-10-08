import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loading, PageHeader, Stat } from "@/components/erp/common";
import { errMsg, fmtDate, inr } from "@/lib/format";
import { selectCls } from "@/lib/po";
import { fyLabel, fyOf } from "@/lib/fy";
import { cn } from "@/lib/utils";

const META = "Vendor account statement: bills, payments, advances and running balance.";
export const Route = createFileRoute("/_authenticated/_shell/finance/vendor-ledger")({
  head: () => ({ meta: [{ title: "Vendor Ledger — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Vendor Ledger — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (s: Record<string, unknown>): { vendor?: string } => (typeof s["vendor"] === "string" ? { vendor: s["vendor"] as string } : {}),
  component: Ledger,
});

type Row = { date: string; doc: string; kind: string; link?: { to: "/finance/vendor-invoices/$id"; id: string }; debit: number; credit: number; note?: string };

function Ledger() {
  const sp = Route.useSearch();
  const [vendor, setVendor] = useState(sp.vendor ?? "");
  const [fy, setFy] = useState(String(fyOf(new Date())));
  const vendors = useQuery({ queryKey: ["ledger-vendors"], queryFn: async () => (await supabase.from("vendors").select("id,company_name,gstin,mobile,email,payment_terms_days").order("company_name")).data ?? [] });
  const q = useQuery({
    queryKey: ["ledger", vendor], enabled: !!vendor,
    queryFn: async () => {
      const [i, p, a, po] = await Promise.all([
        supabase.from("vendor_invoices").select("id,invoice_number,vendor_invoice_number,vendor_invoice_date,net_payable,tds_amount,status").eq("vendor_id", vendor).in("status", ["approved", "partially_paid", "paid"]),
        supabase.from("vendor_payments").select("id,payment_number,payment_date,amount,kind,reference").eq("vendor_id", vendor).eq("status", "recorded"),
        supabase.from("vendor_advance_adjustments").select("amount,created_at,vendor_payments!inner(payment_number,vendor_id),vendor_invoices(invoice_number)").eq("vendor_payments.vendor_id", vendor),
        supabase.from("purchase_orders").select("id,po_number,grand_total,status").eq("vendor_id", vendor).not("status", "in", "(draft,cancelled,rejected)"),
      ]);
      if (i.error) throw i.error;
      const rows: Row[] = [
        ...(i.data ?? []).map((x) => ({ date: x.vendor_invoice_date, doc: x.invoice_number, kind: "Invoice", link: { to: "/finance/vendor-invoices/$id" as const, id: x.id }, debit: 0, credit: Number(x.net_payable), note: `Bill ${x.vendor_invoice_number}${Number(x.tds_amount) ? ` · TDS ${inr(x.tds_amount)}` : ""}` })),
        ...(p.data ?? []).map((x) => ({ date: x.payment_date, doc: x.payment_number, kind: x.kind === "advance" ? "Advance paid" : "Payment", debit: Number(x.amount), credit: 0, note: x.reference ?? "" })),
        ...(a.data ?? []).map((x) => ({ date: x.created_at.slice(0, 10), doc: x.vendor_payments.payment_number, kind: "Advance adjusted", debit: 0, credit: 0, note: `${inr(x.amount)} against ${x.vendor_invoices?.invoice_number}` })),
      ].sort((a, b) => a.date.localeCompare(b.date));
      return { rows, pos: po.data ?? [], advLeft: (p.data ?? []).filter((x) => x.kind === "advance").reduce((s, x) => s + Number(x.amount), 0) - (a.data ?? []).reduce((s, x) => s + Number(x.amount), 0) };
    },
  });
  const v = vendors.data?.find((x) => x.id === vendor);
  const fyN = Number(fy);
  const all = q.data?.rows ?? [];
  const opening = all.filter((r) => fyOf(r.date) < fyN).reduce((s, r) => s + r.credit - r.debit, 0);
  let bal = opening;
  const inFy = all.filter((r) => fyOf(r.date) === fyN).map((r) => ({ ...r, bal: (bal += r.credit - r.debit) }));
  const closing = all.reduce((s, r) => s + r.credit - r.debit, 0);
  const years = [...new Set([fyOf(new Date()), ...all.map((r) => fyOf(r.date))])].sort((a, b) => b - a);
  return (
    <>
      <PageHeader title="Vendor Ledger" subtitle="Credit = approved bills (net of TDS). Debit = recorded payments and advances. Purchase orders are commitments and are shown separately." />
      <div className="mb-3 flex flex-wrap gap-2">
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-64 sm:flex-none")} value={vendor} onChange={(e) => setVendor(e.target.value)}><option value="">Select vendor</option>{vendors.data?.map((x) => <option key={x.id} value={x.id}>{x.company_name}</option>)}</select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-36 sm:flex-none")} value={fy} onChange={(e) => setFy(e.target.value)}>{years.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select>
      </div>
      {!vendor ? <p className="text-sm text-muted-foreground">Choose a vendor to see their account.</p> : q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : (<>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Vendor" value={<span className="text-base">{v?.company_name}</span>} hint={`GSTIN ${v?.gstin ?? "—"}`} />
          <Stat label="Opening balance" value={inr(opening)} hint={fyLabel(fyN)} />
          <Stat label="Outstanding (payable)" value={inr(closing)} hint={closing < 0 ? "Vendor owes us (advance)" : undefined} />
          <Stat label="Unadjusted advances" value={inr(q.data?.advLeft)} />
          <Stat label="Open PO commitments" value={inr((q.data?.pos ?? []).reduce((s, x) => s + Number(x.grand_total), 0))} hint={`${q.data?.pos.length ?? 0} POs — not payable`} />
        </div>
        <p className="mb-2 text-xs text-muted-foreground sm:hidden">Swipe sideways to see every column →</p><div className="overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap" role="region" aria-label="Vendor ledger" tabIndex={0}><table className="w-full text-sm">
          <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Document</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Details</th><th className="px-4 py-3 text-right">Debit</th><th className="px-4 py-3 text-right">Credit</th><th className="px-4 py-3 text-right">Balance</th></tr></thead>
          <tbody>
            <tr className="border-b bg-muted/20"><td className="px-4 py-3" colSpan={6}>Opening balance</td><td className="px-4 py-3 text-right font-medium tabular-nums">{inr(opening)}</td></tr>
            {inFy.length === 0 && <tr><td colSpan={7} className="p-3 text-xs text-muted-foreground">No records in this year.</td></tr>}
            {inFy.map((r, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/40">
                <td className="px-4 py-3">{fmtDate(r.date)}</td>
                <td className="px-4 py-3 font-medium tabular-nums text-xs">{r.link ? <Link className="text-primary hover:underline" to={r.link.to} params={{ id: r.link.id }}>{r.doc}</Link> : r.doc}</td>
                <td className="px-4 py-3">{r.kind}</td><td className="px-4 py-3 text-xs text-muted-foreground">{r.note}</td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{r.debit ? inr(r.debit) : ""}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{r.credit ? inr(r.credit) : ""}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{inr(r.bal)}</td>
              </tr>))}
          </tbody>
        </table></div>
      </>)}
    </>
  );
}
