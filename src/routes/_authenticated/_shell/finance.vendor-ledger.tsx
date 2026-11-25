import { FinanceExport } from "@/components/erp/finance-export";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { useMe } from "@/lib/session";
import { beginDocumentPreview } from "@/components/erp/document-viewer";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadCompleteRows } from "@/lib/complete-register";
import { Loading, PageHeader, Stat } from "@/components/erp/common";
import { SearchableEntrySelect } from "@/components/erp/searchable-entry-select";
import { errMsg, fmtDate, inr } from "@/lib/format";
import { selectCls } from "@/lib/po";
import { fyLabel, fyOf } from "@/lib/fy";
import { cn } from "@/lib/utils";
import { openingLedgerCredit } from "@/lib/opening-ledger-credit";
import { loadLedgerInvoices } from "@/lib/opening-payment-amendments";

const META = "Vendor account statement: bills, payments, advances and running balance.";
export const Route = createFileRoute("/_authenticated/_shell/finance/vendor-ledger")({
  head: () => ({ meta: [{ title: "Vendor Ledger — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Vendor Ledger — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (s: Record<string, unknown>): { vendor?: string } => (typeof s["vendor"] === "string" ? { vendor: s["vendor"] as string } : {}),
  component: Ledger,
});

type Row = { date: string; doc: string; kind: string; link?: { to: "/finance/vendor-invoices/$id"; id: string }; debit: number; credit: number; note?: string };

function Ledger() {
  const sp = Route.useSearch();
  const me=useMe();
  const canStatement=!!me.data?.profile.is_active&&me.data.roles.some(r=>r==="super_admin"||r==="accounts_manager"||r==="director");
  const [vendor, setVendor] = useState(sp.vendor ?? "");
  const [fy, setFy] = useState(String(fyOf(new Date())));
  const vendors = useQuery({
    queryKey: ["ledger-vendors"],
    queryFn: () => loadCompleteRows(async (start, end) => await supabase.from("vendors")
      .select("id,company_name,gstin,mobile,email,payment_terms_days", { count: "exact" })
      .order("company_name").order("id").range(start, end)),
  });
  const q = useQuery({
    queryKey: ["ledger", vendor], enabled: !!vendor,
    queryFn: async () => {
      const [i, p, a, po] = await Promise.all([
        loadLedgerInvoices(vendor),
        loadCompleteRows(async (start, end) => await supabase.from("vendor_payments")
          .select("id,payment_number,payment_date,amount,kind,reference", { count: "exact" })
          .eq("vendor_id", vendor).eq("status", "recorded").order("id").range(start, end)),
        loadCompleteRows(async (start, end) => await supabase.from("vendor_advance_adjustments")
          .select("id,amount,created_at,vendor_payments!inner(payment_number,vendor_id),vendor_invoices(invoice_number)", { count: "exact" })
          .eq("vendor_payments.vendor_id", vendor).order("id").range(start, end)),
        loadCompleteRows(async (start, end) => await supabase.from("purchase_orders")
          .select("id,po_number,grand_total,status", { count: "exact" })
          .eq("vendor_id", vendor)
          .in("status", ["approved", "sent", "partially_received", "partially_accepted"])
          .order("id").range(start, end)),
      ]);
      const rows: Row[] = [
        ...i.flatMap((x): Row[] => {
          const approved=x.opening_payment_amendments.filter(a=>a.status==="approved");
          const ids=new Set<string>();
          for(const amendment of approved){
            const prior=x.opening_vendor_invoice_prior_payments.find(p=>p.id===amendment.prior_payment_id);
            if(!x.is_opening||!amendment.posting_date||!prior||ids.has(prior.id)||Number(prior.amount)!==Number(amendment.amount))
              throw new Error("Historical correction does not reconcile with payment history. Refresh before using the ledger.");
            ids.add(prior.id);
          }
          const {credit,historicalPaid}=openingLedgerCredit({...x,opening_vendor_invoice_prior_payments:x.opening_vendor_invoice_prior_payments.filter(p=>!ids.has(p.id))});
          const bill:Row={date:x.vendor_invoice_date,doc:x.invoice_number,kind:x.is_opening?"Opening payable":"Invoice",link:{to:"/finance/vendor-invoices/$id",id:x.id},debit:0,credit,note:`Bill ${x.vendor_invoice_number}${Number(x.tds_amount)?` · TDS ${inr(x.tds_amount)}`:""}${x.is_opening?` · Pre-ERP paid ${inr(historicalPaid)}; original opening liability`:""}`};
          const corrections:Row[]=approved.map(a=>({date:a.posting_date!,doc:x.invoice_number,kind:"Historical correction",link:{to:"/finance/vendor-invoices/$id",id:x.id},debit:Number(a.amount),credit:0,note:"Reviewed opening liability adjustment — no bank payment"}));
          return [bill,...corrections];
        }),
        ...p.map((x) => ({ date: x.payment_date, doc: x.payment_number, kind: x.kind === "advance" ? "Advance paid" : "Payment", debit: Number(x.amount), credit: 0, note: x.reference ?? "" })),
        ...a.map((x) => ({ date: x.created_at.slice(0, 10), doc: x.vendor_payments.payment_number, kind: "Advance adjusted", debit: 0, credit: 0, note: `${inr(x.amount)} against ${x.vendor_invoices?.invoice_number}` })),
      ].sort((a, b) => a.date.localeCompare(b.date));
      return { rows, pos: po, advLeft: p.filter((x) => x.kind === "advance").reduce((s, x) => s + Number(x.amount), 0) - a.reduce((s, x) => s + Number(x.amount), 0) };
    },
  });
  const v = vendors.data?.find((x) => x.id === vendor);
  const fyN = Number(fy);
  const all = q.data?.rows ?? [];
  const opening = all.filter((r) => fyOf(r.date) < fyN).reduce((s, r) => s + r.credit - r.debit, 0);
  let bal = opening;
  const inFy = all.filter((r) => fyOf(r.date) === fyN).map((r) => ({ ...r, bal: (bal += r.credit - r.debit) }));
  const closing = all.reduce((s, r) => s + r.credit - r.debit, 0);
  const statementReady=canStatement&&q.isSuccess&&!q.isFetching&&vendors.isSuccess&&!vendors.isFetching&&!!v;
  const viewStatement=async()=>{
    if(!statementReady||!v)return;
    const name=("Vendor-statement-"+v.company_name+"-"+fyN).replace(/[^a-zA-Z0-9_.-]/g,"_")+".pdf";
    const preview=beginDocumentPreview(name);
    try{
      const {buildVendorStatement}=await import("@/lib/vendor-statement-pdf");
      const result=await buildVendorStatement({vendor:v.company_name,gstin:v.gstin,year:fyN,opening,rows:inFy,generatedOn:new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())});
      preview.show({name,type:"application/pdf",url:URL.createObjectURL(result.pdf),pages:result.previewPages.map(b=>URL.createObjectURL(b))});
    }catch(e){preview.fail(errMsg(e));}
  };
  const years = [...new Set([fyOf(new Date()), ...all.map((r) => fyOf(r.date))])].sort((a, b) => b - a);
  return (
    <>
      <PageHeader title="Vendor Ledger" subtitle="Credit = approved invoices net of TDS; opening bills include only the liability after pre-ERP payments. Debit = ERP-recorded payments and advances. Purchase orders are separate commitments." />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="w-full sm:w-72"><SearchableEntrySelect label="Vendor" value={vendor} onChange={setVendor} placeholder="Select vendor" options={(vendors.data??[]).map(x=>({value:x.id,label:x.company_name,search:x.gstin??""}))}/></div>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-36 sm:flex-none")} value={fy} onChange={(e) => setFy(e.target.value)}>{years.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select>
      </div>
      {vendors.error ? <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">Cannot verify the complete supplier list: {errMsg(vendors.error)} <button className="font-semibold underline" onClick={() => vendors.refetch()}>Retry</button></div> :
      !vendor ? <p className="text-sm text-muted-foreground">Choose a vendor to see their account.</p> : q.isLoading ? <Loading /> : q.error ? <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">Vendor balances cannot be verified: {errMsg(q.error)} <button className="font-semibold underline" onClick={() => q.refetch()}>Retry</button></div> : (<>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Vendor" value={<span className="text-base">{v?.company_name}</span>} hint={`GSTIN ${v?.gstin ?? "—"}`} />
          <Stat label="Opening balance" value={inr(opening)} hint={fyLabel(fyN)} />
          <Stat label="Selected FY closing" value={inr(inFy.at(-1)?.bal??opening)} hint={fyLabel(fyN)} />
          <Stat label="All-year net balance" value={inr(closing)} hint={closing < 0 ? "Vendor owes us (advance)" : undefined} />
          <Stat label="Unadjusted advances" value={inr(q.data?.advLeft)} />
          <Stat label="Active PO face value" value={inr((q.data?.pos ?? []).reduce((s, x) => s + Number(x.grand_total), 0))} hint={`${q.data?.pos.length ?? 0} active POs · original values, not remaining quantities`} />
        </div>
        <div className="mb-3 flex flex-wrap justify-end gap-2">{canStatement&&<Button type="button" variant="outline" size="sm" disabled={!statementReady} onClick={()=>void viewStatement()}><FileText className="mr-1.5 h-4 w-4"/>View statement PDF</Button>}<FinanceExport name={"vendor-ledger-"+(v?.company_name??"vendor")+"-FY-"+fyLabel(fyN)} ready={q.isSuccess&&!q.isFetching&&vendors.isSuccess&&!vendors.isFetching&&!!v} count={inFy.length+2}
          headers={["Vendor","Financial year","Date","Document","Type","Details","Debit (INR)","Credit (INR)","Running balance (INR)"]}
          rows={()=>[[v?.company_name,fyLabel(fyN),"","","Opening balance","",null,null,opening],...inFy.map(r=>[v?.company_name,fyLabel(fyN),r.date,r.doc,r.kind,r.note,r.debit,r.credit,r.bal]),[v?.company_name,fyLabel(fyN),"","","Closing balance for selected FY","",null,null,inFy.at(-1)?.bal??opening]]}/></div>
        <div className="doc-table finance-doc-table finance-ledger-table overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap" role="region" aria-label="Vendor ledger" tabIndex={0}><table className="w-full text-sm">
          <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Document</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Details</th><th className="px-4 py-3 text-right">Debit</th><th className="px-4 py-3 text-right">Credit</th><th className="px-4 py-3 text-right">Balance</th></tr></thead>
          <tbody>
            <tr className="finance-opening-row border-b bg-muted/20"><td className="px-4 py-3" colSpan={6}>Opening balance</td><td data-label="Opening amount" className="px-4 py-3 text-right font-medium tabular-nums">{inr(opening)}</td></tr>
            {inFy.length === 0 && <tr><td colSpan={7} className="p-3 text-xs text-muted-foreground">No records in this year.</td></tr>}
            {inFy.map((r, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/40">
                <td data-label="Date" className="px-4 py-3">{fmtDate(r.date)}</td>
                <td data-label="Document" className="px-4 py-3 font-medium tabular-nums text-xs">{r.link ? <Link className="text-primary hover:underline" to={r.link.to} params={{ id: r.link.id }}>{r.doc}</Link> : r.doc}</td>
                <td data-label="Type" className="px-4 py-3">{r.kind}</td><td data-label="Details" className="px-4 py-3 text-xs text-muted-foreground">{r.note}</td>
                <td data-label="Debit" className="px-4 py-3 text-right font-medium tabular-nums">{r.debit ? inr(r.debit) : ""}</td><td data-label="Credit" className="px-4 py-3 text-right font-medium tabular-nums">{r.credit ? inr(r.credit) : ""}</td><td data-label="Running balance" className="px-4 py-3 text-right font-medium tabular-nums">{inr(r.bal)}</td>
              </tr>))}
          </tbody>
        </table></div>
      </>)}
    </>
  );
}
