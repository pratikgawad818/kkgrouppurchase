import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadCompleteRows } from "@/lib/complete-register";
import { Button } from "@/components/ui/button";
import { Loading, PageHeader, SearchBox } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, fmtDate, inr } from "@/lib/format";
import { selectCls } from "@/lib/po";
import { fyLabel, fyOf, fyOptions, PAGE } from "@/lib/fy";
import { useCan } from "@/lib/session";
import { badge, INVOICE_STATUS, MATCH_STATUS, type InvoiceStatus } from "@/lib/finance";
import { cn } from "@/lib/utils";

const META = "Vendor invoices matched against purchase orders and goods receipts.";
export const Route = createFileRoute("/_authenticated/_shell/finance/vendor-invoices/")({
  head: () => ({ meta: [{ title: "Vendor Invoices — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Vendor Invoices — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (s: Record<string, unknown>): { status?: string } => (typeof s["status"] === "string" ? { status: s["status"] as string } : {}),
  component: InvoiceList,
});

function InvoiceList() {
  const can = useCan();
  const sp = Route.useSearch();
  const [search, setSearch] = useState("");
  const [f, setF] = useState({ status: sp.status ?? "", vendor: "", project: "", fy: "" });
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ["vendor-invoices"],
    queryFn: async () => {
      return loadCompleteRows(async (start, end) => await supabase.from("vendor_invoices")
        .select("id,invoice_number,vendor_invoice_number,vendor_invoice_date,due_date,grand_total,net_payable,balance_due,status,match_status,vendor_id,project_id,po_id,vendors(company_name),projects(name),purchase_orders(po_number)", { count: "exact" })
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(start, end));
    },
  });
  const all = q.data ?? [];
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(0); };
  const uniq = <T,>(arr: T[], key: (x: T) => string) => [...new Map(arr.map((x) => [key(x), x])).values()];
  const s = search.trim().toLowerCase();
  const rows = all.filter((x) => (!f.status || x.status === f.status) && (!f.vendor || x.vendor_id === f.vendor) && (!f.project || x.project_id === f.project) &&
    (!f.fy || fyOf(x.vendor_invoice_date) === Number(f.fy)) &&
    (!s || [x.invoice_number, x.vendor_invoice_number, x.vendors?.company_name, x.purchase_orders?.po_number].some((v) => v?.toLowerCase().includes(s))));
  const pageRows = rows.slice(page * PAGE, (page + 1) * PAGE);
  return (
    <>
      <PageHeader title="Vendor Invoices" subtitle="Bills from vendors, checked against the purchase order and goods received before they become payable."
        actions={can("vendor_invoice.create") && <Button asChild size="sm"><Link to="/finance/vendor-invoices/new"><Plus className="mr-1 h-4 w-4" />New vendor invoice</Link></Button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="w-full sm:w-60"><SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Invoice, bill no., vendor, PO" /></div>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-48 sm:flex-none")} value={f.status} onChange={(e) => set("status", e.target.value)}><option value="">All statuses</option>{(Object.keys(INVOICE_STATUS) as InvoiceStatus[]).map((k) => <option key={k} value={k}>{INVOICE_STATUS[k].label}</option>)}</select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-48 sm:flex-none")} value={f.vendor} onChange={(e) => set("vendor", e.target.value)}><option value="">All vendors</option>{uniq(all, (x) => x.vendor_id).map((x) => <option key={x.vendor_id} value={x.vendor_id}>{x.vendors?.company_name}</option>)}</select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-44 sm:flex-none")} value={f.project} onChange={(e) => set("project", e.target.value)}><option value="">All projects</option>{uniq(all, (x) => x.project_id).map((x) => <option key={x.project_id} value={x.project_id}>{x.projects?.name}</option>)}</select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-36 sm:flex-none")} value={f.fy} onChange={(e) => set("fy", e.target.value)}><option value="">All years</option>{fyOptions(all.map((x) => x.vendor_invoice_date)).map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">The invoice list is unavailable because the complete register could not be verified: {errMsg(q.error)} <button className="ml-2 font-semibold underline" onClick={() => q.refetch()}>Retry</button></div> : (<>
        <div className="doc-table overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Vendor bill</th><th className="px-4 py-3">Bill date</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">PO</th><th className="px-4 py-3">Project</th><th className="px-4 py-3 text-right">Invoice total</th><th className="px-4 py-3 text-right">Balance due</th><th className="px-4 py-3">Match</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody>
              {pageRows.length === 0 && <tr><td colSpan={11} className="p-4 text-xs text-muted-foreground">No vendor invoices yet.</td></tr>}
              {pageRows.map((x) => (
                <tr key={x.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium tabular-nums"><Link className="text-primary hover:underline" to="/finance/vendor-invoices/$id" params={{ id: x.id }}>{x.invoice_number}</Link></td>
                  <td className="px-4 py-3 font-medium tabular-nums text-xs">{x.vendor_invoice_number}</td>
                  <td className="px-4 py-3">{fmtDate(x.vendor_invoice_date)}</td><td className="px-4 py-3">{fmtDate(x.due_date)}</td>
                  <td className="px-4 py-3">{x.vendors?.company_name}</td>
                  <td className="px-4 py-3 font-medium tabular-nums text-xs"><Link className="hover:underline" to="/procurement/purchase-orders/$id" params={{ id: x.po_id }}>{x.purchase_orders?.po_number}</Link></td>
                  <td className="px-4 py-3">{x.projects?.name}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{inr(x.grand_total)}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{inr(x.balance_due)}</td>
                  <td className="px-4 py-3"><span className={cn(badge, MATCH_STATUS[x.match_status].cls)}>{MATCH_STATUS[x.match_status].label}</span></td>
                  <td className="px-4 py-3"><span className={cn(badge, INVOICE_STATUS[x.status].cls)}>{INVOICE_STATUS[x.status].label}</span></td>
                </tr>))}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={rows.length} size={PAGE} onPage={setPage} />
      </>)}
    </>
  );
}
