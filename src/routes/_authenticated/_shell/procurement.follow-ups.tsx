import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, ArrowUpRight, CalendarClock, ClipboardCheck, FileWarning, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PageHeader, Loading, SearchBox, Stat, Empty } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, fmtDate, inr } from "@/lib/format";
import { selectCls, type PoStatus } from "@/lib/po";
import { fyLabel, fyOf, fyOptions, PAGE } from "@/lib/fy";
import { today as todayIst, type InvoiceStatus } from "@/lib/finance";
import { useCan } from "@/lib/session";
import { cn } from "@/lib/utils";
import {
  ACTIVE_DELIVERY_PO_STATUSES,
  deliverySnapshot,
  isOverdueApprovedInvoice,
  needsInvoiceMatchReview,
  type DeliveryPriority,
} from "@/lib/procurement-followup";

const OPEN_PO_STATUSES: PoStatus[] = ["pending_approval", ...ACTIVE_DELIVERY_PO_STATUSES];
const INVOICE_STATES: InvoiceStatus[] = ["exception", "pending_review", "approved", "partially_paid"];
const PRIORITY: Record<DeliveryPriority, { label: string; cls: string; hint: string }> = {
  overdue: { label: "Overdue", cls: "border-destructive/30 bg-destructive/10 text-destructive", hint: "Contact supplier immediately" },
  due_soon: { label: "Due within 7 days", cls: "border-amber-300 bg-amber-50 text-amber-900", hint: "Confirm dispatch and site readiness" },
  unscheduled: { label: "Date missing", cls: "border-amber-300 bg-amber-50 text-amber-900", hint: "Set an expected delivery date" },
  on_track: { label: "Upcoming", cls: "border-border bg-muted text-muted-foreground", hint: "Track confirmed delivery date" },
};
const PRIORITY_RANK: Record<DeliveryPriority, number> = { overdue: 0, due_soon: 1, unscheduled: 2, on_track: 3 };
const CAP = 2000;

export const Route = createFileRoute("/_authenticated/_shell/procurement/follow-ups")({
  head: () => ({ meta: [{ title: "Procurement Follow-ups — KK GROUP ERP" }] }),
  component: ProcurementFollowUps,
});

function ProcurementFollowUps() {
  const can = useCan();
  const canPo = can("purchase_order.view");
  const canInvoice = can("vendor_invoice.view");
  const canPayable = can("payable.view");
  const [project, setProject] = useState("");
  const [vendor, setVendor] = useState("");
  const [search, setSearch] = useState("");
  const [fy, setFy] = useState("");
  const [priority, setPriority] = useState<DeliveryPriority | "all">("all");
  const [page, setPage] = useState(0);
  const today = todayIst();

  const poQuery = useQuery({
    queryKey: ["procurement-followups", "purchase-orders"],
    enabled: canPo,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_orders")
        .select("id,po_number,po_date,expected_delivery_date,grand_total,status,project_id,vendor_id,building_id,vendors(company_name),projects(name),buildings(name),purchase_order_items(ordered_quantity,accepted_quantity,short_closed_quantity,line_total)")
        .in("status", OPEN_PO_STATUSES).order("created_at", { ascending: false }).limit(CAP + 1);
      if (error) throw error;
      return { rows: (data ?? []).slice(0, CAP), truncated: (data?.length ?? 0) > CAP };
    },
  });
  const invoiceQuery = useQuery({
    queryKey: ["procurement-followups", "vendor-invoices"],
    enabled: canInvoice || canPayable,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("vendor_invoices")
        .select("id,invoice_number,vendor_invoice_number,due_date,vendor_invoice_date,status,match_status,grand_total,balance_due,project_id,vendor_id,po_id,vendors(company_name),projects(name),purchase_orders(po_number)")
        .in("status", INVOICE_STATES).order("created_at", { ascending: false }).limit(CAP + 1);
      if (error) throw error;
      return { rows: (data ?? []).slice(0, CAP), truncated: (data?.length ?? 0) > CAP };
    },
  });

  const pos = canPo ? poQuery.data?.rows ?? [] : [];
  const invoices = canInvoice || canPayable ? invoiceQuery.data?.rows ?? [] : [];
  const projects = [...new Map([...pos, ...invoices]
    .map(x => [x.project_id, { id: x.project_id, name: x.projects?.name ?? "Project" }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const vendors = [...new Map([...pos, ...invoices]
    .map(x => [x.vendor_id, { id: x.vendor_id, name: x.vendors?.company_name ?? "Vendor" }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const yearOptions = fyOptions([...pos.map(x => x.po_date), ...invoices.map(x => x.vendor_invoice_date)]);
  const term = search.trim().toLowerCase();

  const scoped = (x: { project_id: string; vendor_id: string }, date: string, values: (string | null | undefined)[]) =>
    (!project || x.project_id === project) &&
    (!vendor || x.vendor_id === vendor) &&
    (!fy || fyOf(date) === Number(fy)) &&
    (!term || values.some(value => value?.toLowerCase().includes(term)));

  const scopedPos = pos.filter(x => scoped(x, x.po_date, [x.po_number, x.vendors?.company_name, x.projects?.name, x.buildings?.name]));
  const pendingApproval = scopedPos.filter(x => x.status === "pending_approval");
  const deliveries = scopedPos.flatMap(po => {
    const snapshot = deliverySnapshot(po, today);
    return snapshot ? [{ po, snapshot }] : [];
  }).sort((a, b) => PRIORITY_RANK[a.snapshot.priority] - PRIORITY_RANK[b.snapshot.priority] ||
    (a.po.expected_delivery_date ?? "9999-12-31").localeCompare(b.po.expected_delivery_date ?? "9999-12-31"));
  const delayed = deliveries.filter(x => x.snapshot.priority === "overdue");
  const upcoming = deliveries.filter(x => x.snapshot.priority === "due_soon");
  const unscheduled = deliveries.filter(x => x.snapshot.priority === "unscheduled");
  const deliveryRows = priority === "all" ? deliveries : deliveries.filter(x => x.snapshot.priority === priority);
  const pagedDeliveries = deliveryRows.slice(page * PAGE, (page + 1) * PAGE);

  const scopedInvoices = invoices.filter(x => scoped(x, x.vendor_invoice_date,
    [x.invoice_number, x.vendor_invoice_number, x.vendors?.company_name, x.projects?.name, x.purchase_orders?.po_number]));
  const exceptions = canInvoice ? scopedInvoices.filter(needsInvoiceMatchReview) : [];
  const overduePayables = canPayable ? scopedInvoices.filter(x => isOverdueApprovedInvoice(x, today))
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")) : [];
  const overdueValue = overduePayables.reduce((sum, invoice) => sum + Number(invoice.balance_due), 0);
  const hasAccess = canPo || canInvoice || canPayable;
  const loading = (canPo && poQuery.isLoading) || ((canInvoice || canPayable) && invoiceQuery.isLoading);
  const poError = canPo ? poQuery.error : null;
  const invoiceError = canInvoice || canPayable ? invoiceQuery.error : null;
  const changeFilter = (setter: (v: string) => void, value: string) => { setter(value); setPage(0); };
  const capped = (canPo && poQuery.data?.truncated) || ((canInvoice || canPayable) && invoiceQuery.data?.truncated);

  return (
    <>
      <PageHeader title="Procurement Follow-ups" subtitle="A live action list for builders: material deliveries, purchase approvals, vendor bill exceptions and overdue approved payables."
        actions={canPo && <Button asChild variant="outline" size="sm"><Link to="/procurement/purchase-orders">All purchase orders <ArrowUpRight className="ml-1 h-4 w-4" /></Link></Button>} />

      {!hasAccess ? <Empty>Your account does not have purchasing or finance viewing access.</Empty> : <>
        <div className="mb-4 flex flex-wrap gap-2">
          <div className="w-full sm:w-60"><SearchBox value={search} onChange={v => changeFilter(setSearch, v)} placeholder="Search PO, vendor, project or invoice" /></div>
          <select aria-label="Filter by project" className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-48 sm:flex-none")} value={project} onChange={e => changeFilter(setProject, e.target.value)}>
            <option value="">All projects</option>{projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <select aria-label="Filter by supplier" className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-48 sm:flex-none")} value={vendor} onChange={e => changeFilter(setVendor, e.target.value)}>
            <option value="">All suppliers</option>{vendors.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <select aria-label="Filter financial year" className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-36 sm:flex-none")} value={fy} onChange={e => changeFilter(setFy, e.target.value)}>
            <option value="">All years</option>{yearOptions.map(y => <option key={y} value={y}>{fyLabel(y)}</option>)}
          </select>
        </div>

        {loading ? <Loading /> : <>
          {(poError || invoiceError) && <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {poError && <p>Purchase orders could not be loaded: {errMsg(poError)}</p>}
            {invoiceError && <p>Invoices could not be loaded: {errMsg(invoiceError)}</p>}
          </div>}
          {capped && <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Your database has more than {CAP.toLocaleString("en-IN")} active records in at least one queue. Figures here cover only the latest {CAP.toLocaleString("en-IN")} records in that queue; use individual modules for the complete history.
          </p>}
          <div className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {canPo && <>
              <a href="#pending-po-approvals"><Stat label="POs awaiting approval" value={poError ? "—" : pendingApproval.length} hint="Director decisions needed" className="hover:border-primary/40" /></a>
              <button type="button" className="text-left" onClick={() => { setPriority("overdue"); setPage(0); }}>
                <Stat label="Overdue deliveries" value={poError ? "—" : delayed.length} hint={poError ? undefined : `${inr(delayed.reduce((n, x) => n + x.snapshot.estimatedOpenLineValue, 0))} open line value¹`} className="hover:border-destructive/40" />
              </button>
              <button type="button" className="text-left" onClick={() => { setPriority("due_soon"); setPage(0); }}>
                <Stat label="Due within 7 days" value={poError ? "—" : upcoming.length} hint="Open supplier deliveries" className="hover:border-amber-400" />
              </button>
              <button type="button" className="text-left" onClick={() => { setPriority("unscheduled"); setPage(0); }}>
                <Stat label="Delivery dates missing" value={poError ? "—" : unscheduled.length} hint="Confirm a date with suppliers" className="hover:border-amber-400" />
              </button>
            </>}
            {canInvoice && <a href="#invoice-exceptions"><Stat label="Invoice match exceptions" value={invoiceError ? "—" : exceptions.length} hint="Review PO / GRN differences" className="hover:border-destructive/40" /></a>}
            {canPayable && <Link to="/finance/payables"><Stat label="Overdue approved bills" value={invoiceError ? "—" : inr(overdueValue)} hint={invoiceError ? undefined : `${overduePayables.length} invoices unpaid`} className="hover:border-amber-400" /></Link>}
          </div>

          {canPo && !poError && <>
            <section className="mb-8">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div><h3 className="text-base font-semibold">Supplier delivery follow-up</h3>
                  <p className="text-xs text-muted-foreground">Sorted by urgency. Open quantities use accepted goods minus any short-closed commitment.</p></div>
                <select aria-label="Delivery follow-up priority" className={cn(selectCls, "h-11 w-full sm:h-9 sm:w-52")} value={priority} onChange={e => { setPriority(e.target.value as DeliveryPriority | "all"); setPage(0); }}>
                  <option value="all">All open deliveries ({deliveries.length})</option>
                  <option value="overdue">Overdue ({delayed.length})</option>
                  <option value="due_soon">Due in 7 days ({upcoming.length})</option>
                  <option value="unscheduled">Date missing ({unscheduled.length})</option>
                  <option value="on_track">Upcoming ({deliveries.filter(x => x.snapshot.priority === "on_track").length})</option>
                </select>
              </div>
              {!deliveryRows.length ? <Empty>No purchase orders match these delivery follow-up filters.</Empty> : <>
                <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
                  {pagedDeliveries.map(({ po, snapshot }) => <article key={po.id} className="rounded-xl border bg-card p-4 shadow-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><Link to="/procurement/purchase-orders/$id" params={{ id: po.id }} className="font-semibold text-primary hover:underline">{po.po_number}</Link><p className="mt-1 text-sm font-medium">{po.vendors?.company_name}</p></div>
                      <PriorityBadge priority={snapshot.priority} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{po.projects?.name}{po.buildings?.name ? ` · ${po.buildings.name}` : ""}</p>
                    <div className="mt-3 grid grid-cols-2 gap-3 border-y py-3 text-sm">
                      <div><p className="text-xs text-muted-foreground">Expected delivery</p><p className="font-medium">{fmtDate(po.expected_delivery_date)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Open line value¹</p><p className="font-medium tabular-nums">{inr(snapshot.estimatedOpenLineValue)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Open material lines</p><p className="font-medium">{snapshot.openLines} of {snapshot.totalLines}</p></div>
                      <div><p className="text-xs text-muted-foreground">Accepted / committed²</p><p className="font-medium">{snapshot.acceptancePercent}%</p></div>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">{PRIORITY[snapshot.priority].hint}</p>
                    <Link className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-primary hover:underline" to="/procurement/purchase-orders/$id" params={{ id: po.id }}>Review purchase order <ArrowUpRight className="ml-1 h-4 w-4" /></Link>
                  </article>)}
                </div>
                <div className="hidden overflow-x-auto rounded-xl border bg-card lg:block">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b bg-muted/40 text-xs text-muted-foreground"><tr>
                      <th scope="col" className="p-3">Purchase order / supplier</th><th scope="col" className="p-3">Site</th><th scope="col" className="p-3">Delivery</th><th scope="col" className="p-3">Urgency</th><th scope="col" className="p-3 text-right">Open lines</th><th scope="col" className="p-3 text-right">Accepted²</th><th scope="col" className="p-3 text-right">Open line value¹</th>
                    </tr></thead>
                    <tbody>{pagedDeliveries.map(({ po, snapshot }) => <tr key={po.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="p-3"><Link className="font-semibold text-primary hover:underline" to="/procurement/purchase-orders/$id" params={{ id: po.id }}>{po.po_number}</Link><div className="text-xs text-muted-foreground">{po.vendors?.company_name}</div></td>
                      <td className="p-3 text-xs">{po.projects?.name}{po.buildings?.name ? ` · ${po.buildings.name}` : ""}</td>
                      <td className="p-3 tabular-nums">{fmtDate(po.expected_delivery_date)}</td>
                      <td className="p-3"><PriorityBadge priority={snapshot.priority} /></td>
                      <td className="p-3 text-right tabular-nums">{snapshot.openLines} / {snapshot.totalLines}</td>
                      <td className="p-3 text-right tabular-nums">{snapshot.acceptancePercent}%</td>
                      <td className="p-3 text-right font-semibold tabular-nums">{inr(snapshot.estimatedOpenLineValue)}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
                <Pager page={page} total={deliveryRows.length} size={PAGE} onPage={setPage} />
              </>}
              <p className="mt-2 text-xs text-muted-foreground">
                ¹ Estimated undelivered purchase-order line value (proportional to quantity, excluding unallocated PO-level freight/charges/discounts). Not a payable or accounting balance.
                ² Accepted quantity relative to the commitment remaining after short-closing, not total material received.
              </p>
            </section>

            <section id="pending-po-approvals" className="mb-8 scroll-mt-24 rounded-xl border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h3 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4 text-primary" />POs awaiting director approval</h3><p className="text-xs text-muted-foreground">Purchases should not proceed before three distinct director approvals.</p></div>
                <Link className="text-sm font-medium text-primary hover:underline" to="/procurement/purchase-orders">Open PO register →</Link>
              </div>
              {pendingApproval.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No pending purchase orders for these filters.</p> :
                <div className="mt-3 flex flex-wrap gap-2">{pendingApproval.slice(0, 12).map(po => <Link key={po.id} to="/procurement/purchase-orders/$id" params={{ id: po.id }} className="rounded-lg border px-3 py-2 text-sm hover:border-primary/40">
                  <strong className="text-primary">{po.po_number}</strong> <span className="text-muted-foreground">· {po.vendors?.company_name}</span>
                </Link>)}</div>}
              {pendingApproval.length > 12 && <p className="mt-2 text-xs text-muted-foreground">{pendingApproval.length - 12} additional purchase orders in the register.</p>}
            </section>
          </>}

          {canInvoice && !invoiceError && <section id="invoice-exceptions" className="mb-8 scroll-mt-24">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="flex items-center gap-2 text-base font-semibold"><FileWarning className="h-5 w-5 text-amber-600" />Invoice matching exceptions</h3>
                <p className="text-xs text-muted-foreground">Resolve quantity, rate or tax differences against the PO and posted GRNs before approval.</p></div>
              <Link className="text-sm font-medium text-primary hover:underline" to="/finance/vendor-invoices" search={{ status: "" }}>All invoices →</Link>
            </div>
            {exceptions.length === 0 ? <Empty>No invoice matching exceptions for these filters.</Empty> :
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{exceptions.slice(0, 18).map(invoice =>
                <Link key={invoice.id} to="/finance/vendor-invoices/$id" params={{ id: invoice.id }} className="rounded-xl border bg-card p-4 transition-colors hover:border-primary/40">
                  <div className="flex items-start justify-between gap-3"><span className="font-semibold text-primary">{invoice.invoice_number}</span>
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">Review match</span></div>
                  <p className="mt-1 truncate text-sm">{invoice.vendors?.company_name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Vendor bill: {invoice.vendor_invoice_number} · PO: {invoice.purchase_orders?.po_number ?? "—"}</p>
                  <div className="mt-3 flex items-end justify-between"><span className="text-xs text-muted-foreground">{invoice.projects?.name}</span><span className="font-semibold tabular-nums">{inr(invoice.grand_total)}</span></div>
                </Link>)}</div>}
            {exceptions.length > 18 && <p className="mt-3 text-xs text-muted-foreground">Showing 18 of {exceptions.length} exceptions. See the full invoice register.</p>}
          </section>}

          {canPayable && !invoiceError && <section className="mb-8">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="flex items-center gap-2 text-base font-semibold"><CalendarClock className="h-5 w-5 text-destructive" />Overdue approved vendor bills</h3>
                <p className="text-xs text-muted-foreground">Only approved or partially paid invoices with an outstanding balance.</p></div>
              <Link className="text-sm font-medium text-primary hover:underline" to="/finance/payables">Accounts payable →</Link>
            </div>
            {overduePayables.length === 0 ? <Empty>No overdue approved invoices for these filters.</Empty> :
              <div className="overflow-hidden rounded-xl border bg-card">{overduePayables.slice(0, 25).map(invoice => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-4 last:border-0">
                <div className="min-w-0"><Link className="font-semibold text-primary hover:underline" to="/finance/vendor-invoices/$id" params={{ id: invoice.id }}>{invoice.invoice_number}</Link>
                  <div className="mt-1 text-xs text-muted-foreground">{invoice.vendors?.company_name} · {invoice.projects?.name} · Due {fmtDate(invoice.due_date)}</div></div>
                <span className="font-semibold tabular-nums">{inr(invoice.balance_due)}</span>
              </div>)}</div>}
            {overduePayables.length > 25 && <p className="mt-2 text-xs text-muted-foreground">Showing the earliest 25 overdue invoices. Open Accounts Payable for the rest.</p>}
          </section>}

          <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mr-1 inline h-4 w-4 align-middle" aria-hidden />
            This dashboard is read-only. Follow up with the supplier, record delivery challans and GRNs in their existing modules, and approve or record vendor payments through the authorised workflow.
          </p>
        </>}
      </>}
    </>
  );
}

function PriorityBadge({ priority }: { priority: DeliveryPriority }) {
  const p = PRIORITY[priority];
  return <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold", p.cls)}>
    {priority === "overdue" ? <AlertTriangle className="mr-1 h-3 w-3" aria-hidden /> : priority === "due_soon" ? <Truck className="mr-1 h-3 w-3" aria-hidden /> : null}
    {p.label}
  </span>;
}
