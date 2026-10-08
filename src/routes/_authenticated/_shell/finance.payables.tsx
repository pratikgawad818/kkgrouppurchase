import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loading, PageHeader, Stat } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, fmtDate, inr } from "@/lib/format";
import { selectCls } from "@/lib/po";
import { fyLabel, fyOf, fyOptions, PAGE } from "@/lib/fy";
import { addDays, badge, INVOICE_STATUS, today } from "@/lib/finance";
import { cn } from "@/lib/utils";

const META = "Outstanding vendor bills, due dates and vendor-wise balances.";
export const Route = createFileRoute("/_authenticated/_shell/finance/payables")({
  head: () => ({ meta: [{ title: "Accounts Payable — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Accounts Payable — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Payables,
});

function Payables() {
  const [f, setF] = useState({ vendor: "", project: "", fy: "", due: "" });
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ["payables"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendor_invoices")
        .select("id,invoice_number,vendor_invoice_number,vendor_invoice_date,due_date,net_payable,amount_paid,advance_adjusted,balance_due,status,vendor_id,project_id,vendors(company_name),projects(name)")
        .in("status", ["approved", "partially_paid", "paid"]).order("due_date", { ascending: true }).limit(3000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const all = q.data ?? [];
  const t = today(); const in7 = addDays(t, 7);
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(0); };
  const scoped = all.filter((x) => (!f.vendor || x.vendor_id === f.vendor) && (!f.project || x.project_id === f.project) && (!f.fy || fyOf(x.vendor_invoice_date) === Number(f.fy)));
  const open = scoped.filter((x) => x.status !== "paid");
  const sum = (a: typeof all) => a.reduce((s, x) => s + Number(x.balance_due), 0);
  const overdue = open.filter((x) => x.due_date && x.due_date < t);
  const dueToday = open.filter((x) => x.due_date === t);
  const due7 = open.filter((x) => x.due_date && x.due_date >= t && x.due_date <= in7);
  const rows = scoped.filter((x) => !f.due || (f.due === "overdue" ? overdue.includes(x) : f.due === "today" ? dueToday.includes(x) : f.due === "7" ? due7.includes(x) : f.due === "paid" ? x.status === "paid" : f.due === "partial" ? x.status === "partially_paid" : x.status !== "paid"));
  const byVendor = [...open.reduce((m, x) => m.set(x.vendor_id, { name: x.vendors?.company_name ?? "", amt: (m.get(x.vendor_id)?.amt ?? 0) + Number(x.balance_due), n: (m.get(x.vendor_id)?.n ?? 0) + 1 }), new Map<string, { name: string; amt: number; n: number }>()).entries()].sort((a, b) => b[1].amt - a[1].amt);
  const uniq = <T,>(arr: T[], key: (x: T) => string) => [...new Map(arr.map((x) => [key(x), x])).values()];
  const pageRows = rows.slice(page * PAGE, (page + 1) * PAGE);
  return (
    <>
      <PageHeader title="Accounts Payable" subtitle="Only approved vendor invoices are payable. Purchase orders and goods receipts are not counted here." />
      <div className="mb-3 flex flex-wrap gap-2">
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-48 sm:flex-none")} value={f.vendor} onChange={(e) => set("vendor", e.target.value)}><option value="">All vendors</option>{uniq(all, (x) => x.vendor_id).map((x) => <option key={x.vendor_id} value={x.vendor_id}>{x.vendors?.company_name}</option>)}</select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-44 sm:flex-none")} value={f.project} onChange={(e) => set("project", e.target.value)}><option value="">All projects</option>{uniq(all, (x) => x.project_id).map((x) => <option key={x.project_id} value={x.project_id}>{x.projects?.name}</option>)}</select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-36 sm:flex-none")} value={f.fy} onChange={(e) => set("fy", e.target.value)}><option value="">All years</option>{fyOptions(all.map((x) => x.vendor_invoice_date)).map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select>
        <select className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-40 sm:flex-none")} value={f.due} onChange={(e) => set("due", e.target.value)}><option value="">All outstanding</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="7">Due in 7 days</option><option value="partial">Partially paid</option><option value="paid">Paid</option></select>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : (<>
        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Total outstanding" value={inr(sum(open))} hint={`${open.length} bills`} />
          <Stat label="Due today" value={inr(sum(dueToday))} hint={`${dueToday.length} bills`} />
          <Stat label="Due in 7 days" value={inr(sum(due7))} hint={`${due7.length} bills`} />
          <Stat label="Overdue" value={inr(sum(overdue))} hint={`${overdue.length} bills`} />
          <Stat label="Partially paid" value={String(scoped.filter((x) => x.status === "partially_paid").length)} />
          <Stat label="Paid" value={String(scoped.filter((x) => x.status === "paid").length)} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="doc-table rounded-xl border bg-card shadow-card lg:col-span-2">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">Due</th><th className="px-4 py-3 text-right">Net payable</th><th className="px-4 py-3 text-right">Paid + adjusted</th><th className="px-4 py-3 text-right">Balance</th><th className="px-4 py-3">Status</th></tr></thead>
              <tbody>
                {pageRows.length === 0 && <tr><td colSpan={7} className="p-4 text-xs text-muted-foreground">No records.</td></tr>}
                {pageRows.map((x) => (
                  <tr key={x.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium tabular-nums"><Link className="text-primary hover:underline" to="/finance/vendor-invoices/$id" params={{ id: x.id }}>{x.invoice_number}</Link><div className="text-[11px] text-muted-foreground">{x.vendor_invoice_number}</div></td>
                    <td className="px-4 py-3">{x.vendors?.company_name}</td>
                    <td className={cn("p-2", x.status !== "paid" && x.due_date && x.due_date < t && "font-medium text-destructive")}>{fmtDate(x.due_date)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{inr(x.net_payable)}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{inr(Number(x.amount_paid) + Number(x.advance_adjusted))}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{inr(x.balance_due)}</td>
                    <td className="px-4 py-3"><span className={cn(badge, INVOICE_STATUS[x.status].cls)}>{INVOICE_STATUS[x.status].label}</span></td>
                  </tr>))}
              </tbody>
            </table></div>
            <div className="p-2"><Pager page={page} total={rows.length} size={PAGE} onPage={setPage} /></div>
          </div>
          <div className="rounded-md border bg-card p-4">
            <div className="mb-2 text-sm font-medium">Vendor-wise outstanding</div>
            {byVendor.length === 0 ? <p className="text-xs text-muted-foreground">No records.</p> : <ul className="space-y-1 text-sm">{byVendor.map(([vid, v]) => <li key={vid} className="flex justify-between gap-2"><Link className="truncate hover:underline" to="/finance/vendor-ledger" search={{ vendor: vid }}>{v.name} <span className="text-xs text-muted-foreground">({v.n})</span></Link><span className="font-mono">{inr(v.amt)}</span></li>)}</ul>}
          </div>
        </div>
      </>)}
    </>
  );
}
