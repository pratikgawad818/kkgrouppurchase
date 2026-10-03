import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Building2, Package, Plus, Store, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Stat, Loading } from "@/components/erp/common";
import { fmtDateTime } from "@/lib/format";
import { useCan } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/_shell/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — KK GROUP ERP" }, { name: "description", content: "Procurement, inventory, vendor and project overview." }, { property: "og:title", content: "Dashboard — KK GROUP ERP" }, { property: "og:description", content: "Procurement, inventory, vendor and project overview." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Dashboard,
});

function fyOf(d: Date) { const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return y; }
function fyLabel(y: number) { return `FY ${y}–${String(y + 1).slice(2)}`; }
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

function Pending({ label, phase }: { label: string; phase: number }) {
  return <div className="rounded-md border border-dashed bg-card p-4"><div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1.5 text-xs text-muted-foreground">Available from Phase {phase}</div></div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-6"><h2 className="mb-2 text-sm font-semibold">{title}</h2><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div></section>;
}

function PrSummary({ fy, projectId, buildingId, canCreate }: { fy: number; projectId: string; buildingId: string; canCreate: boolean }) {
  const q = useQuery({
    queryKey: ["prs", "summary", fy, projectId, buildingId],
    queryFn: async () => {
      let r = supabase.from("purchase_requests").select("status,required_by").gte("request_date", `${fy}-04-01`).lte("request_date", `${fy + 1}-03-31`).limit(5000);
      if (projectId) r = r.eq("project_id", projectId);
      if (buildingId) r = r.eq("building_id", buildingId);
      const { data, error } = await r;
      if (error) throw error;
      const soon = new Date(); soon.setDate(soon.getDate() + 7); const s = soon.toISOString().slice(0, 10);
      const rows = data ?? [];
      const c = (st: string) => rows.filter((x) => x.status === st).length;
      return { total: rows.length, draft: c("draft"), pending: c("pending_approval"), approved: c("approved"), rejected: c("rejected"), due: rows.filter((x) => ["draft", "pending_approval", "approved"].includes(x.status) && x.required_by <= s).length };
    },
  });
  const d = q.data;
  const card = (label: string, value: number | undefined, search: { status?: string; due?: string }) => (
    <Link to="/procurement/purchase-requests" search={search}><Stat label={label} value={value ?? "—"} className="hover:border-primary/50" /></Link>
  );
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Purchase Requests <span className="font-normal text-muted-foreground">· {d?.total ?? 0} total in {fyLabel(fy)}</span></h2>{canCreate && <Button asChild size="sm"><Link to="/procurement/purchase-requests/new"><Plus className="h-4 w-4" />Purchase Request</Link></Button>}</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {card("Draft", d?.draft, { status: "draft" })}
        {card("Pending approval", d?.pending, { status: "pending_approval" })}
        {card("Approved", d?.approved, { status: "approved" })}
        {card("Rejected", d?.rejected, { status: "rejected" })}
        {card("Due in 7 days", d?.due, { due: "1" })}
      </div>
    </section>
  );
}

function PoSummary({ fy, projectId, buildingId }: { fy: number; projectId: string; buildingId: string }) {
  const q = useQuery({
    queryKey: ["pos", "summary", fy, projectId, buildingId],
    queryFn: async () => {
      let r = supabase.from("purchase_orders").select("status,grand_total,purchase_order_items(ordered_quantity,received_quantity,line_total)").gte("po_date", `${fy}-04-01`).lte("po_date", `${fy + 1}-03-31`).limit(5000);
      if (projectId) r = r.eq("project_id", projectId);
      if (buildingId) r = r.eq("building_id", buildingId);
      const { data, error } = await r;
      if (error) throw error;
      const rows = data ?? [];
      const c = (st: string) => rows.filter((x) => x.status === st).length;
      let pendingValue = 0;
      for (const x of rows) if (["approved", "sent", "partially_received"].includes(x.status))
        for (const i of x.purchase_order_items) pendingValue += Number(i.ordered_quantity) ? Number(i.line_total) * (Number(i.ordered_quantity) - Number(i.received_quantity)) / Number(i.ordered_quantity) : 0;
      return { total: rows.length, pending: c("pending_approval"), approved: c("approved"), sent: c("sent"), partial: c("partially_received"), full: c("fully_received"), pendingValue };
    },
  });
  const d = q.data;
  const card = (label: string, value: React.ReactNode) => <Link to="/procurement/purchase-orders"><Stat label={label} value={value ?? "—"} className="hover:border-primary/50" /></Link>;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold">Purchase Orders <span className="font-normal text-muted-foreground">· {d?.total ?? 0} in {fyLabel(fy)}</span></h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {card("Pending approval", d?.pending)}{card("Approved", d?.approved)}{card("Sent", d?.sent)}
        {card("Partially received", d?.partial)}{card("Fully received", d?.full)}{card("Pending receipt value", d ? inr(d.pendingValue) : undefined)}
      </div>
    </section>
  );
}

function GrnSummary({ fy, projectId, buildingId }: { fy: number; projectId: string; buildingId: string }) {
  const q = useQuery({
    queryKey: ["grns", "summary", fy, projectId, buildingId],
    queryFn: async () => {
      let r = supabase.from("goods_receipt_notes").select("id,grn_number,received_date,status,vendors(company_name)").neq("status", "cancelled").gte("received_date", `${fy}-04-01`).lte("received_date", `${fy + 1}-03-31`).order("created_at", { ascending: false }).limit(5000);
      if (projectId) r = r.eq("project_id", projectId);
      if (buildingId) r = r.eq("building_id", buildingId);
      const { data, error } = await r;
      if (error) throw error;
      const m = new Date().toISOString().slice(0, 7);
      const rows = data ?? [];
      return { fy: rows.length, month: rows.filter((x) => x.received_date.startsWith(m)).length, drafts: rows.filter((x) => x.status === "draft").length, recent: rows.slice(0, 5) };
    },
  });
  const d = q.data;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold">Goods Received</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link to="/inventory/goods-received"><Stat label="This month" value={d?.month ?? "—"} className="hover:border-primary/50" /></Link>
        <Link to="/inventory/goods-received"><Stat label={fyLabel(fy)} value={d?.fy ?? "—"} className="hover:border-primary/50" /></Link>
        <Link to="/inventory/goods-received"><Stat label="Drafts awaiting posting" value={d?.drafts ?? "—"} className="hover:border-primary/50" /></Link>
        <div className="rounded-md border bg-card p-3 text-xs">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Recent GRNs</div>
          {d?.recent.length ? d.recent.map((g) => <div key={g.id} className="flex justify-between"><Link className="font-mono text-primary hover:underline" to="/inventory/goods-received/$id" params={{ id: g.id }}>{g.grn_number}</Link><span className="truncate pl-2 text-muted-foreground">{g.vendors?.company_name}</span></div>) : <div className="text-muted-foreground">None yet</div>}
        </div>
      </div>
    </section>
  );
}

function ApCards() {
  const q = useQuery({
    queryKey: ["payables", "summary"],
    queryFn: async () => {
      const t = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      const [i, p] = await Promise.all([
        supabase.from("vendor_invoices").select("status,balance_due,due_date").in("status", ["approved", "partially_paid", "pending_review", "exception"]),
        supabase.from("vendor_payments").select("amount").eq("status", "recorded").gte("payment_date", t.slice(0, 8) + "01"),
      ]);
      const rows = i.data ?? [];
      const open = rows.filter((x) => x.status === "approved" || x.status === "partially_paid");
      return {
        outstanding: open.reduce((a, x) => a + Number(x.balance_due), 0),
        overdue: open.filter((x) => x.due_date && x.due_date < t).reduce((a, x) => a + Number(x.balance_due), 0),
        overdueN: open.filter((x) => x.due_date && x.due_date < t).length,
        pending: rows.filter((x) => x.status === "pending_review").length,
        exceptions: rows.filter((x) => x.status === "exception").length,
        paid: (p.data ?? []).reduce((a, x) => a + Number(x.amount), 0),
      };
    },
  });
  const d = q.data;
  return <>
    <Link to="/finance/payables"><Stat label="Vendor payables" value={d ? inr(d.outstanding) : "—"} hint={d ? `${d.pending} awaiting approval · ${d.exceptions} exceptions` : undefined} className="hover:border-primary/50" /></Link>
    <Link to="/finance/payables"><Stat label="Overdue bills" value={d ? inr(d.overdue) : "—"} hint={d ? `${d.overdueN} bills` : undefined} className="hover:border-primary/50" /></Link>
    <Link to="/finance/payments"><Stat label="Payments this month" value={d ? inr(d.paid) : "—"} hint="Recorded payments" className="hover:border-primary/50" /></Link>
  </>;
}

function InvCards() {
  const q = useQuery({
    queryKey: ["stock", "summary"],
    queryFn: async () => {
      const [s, t] = await Promise.all([
        supabase.from("warehouse_stock").select("quantity_on_hand,total_value,items(reorder_level)").limit(5000),
        supabase.from("stock_transfers").select("id", { count: "exact", head: true }).gte("transfer_date", new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)),
      ]);
      if (s.error) throw s.error;
      const rows = s.data ?? [];
      return {
        value: rows.reduce((a, x) => a + Number(x.total_value), 0),
        low: rows.filter((x) => Number(x.quantity_on_hand) > 0 && Number(x.quantity_on_hand) <= Number(x.items?.reorder_level ?? 0)).length,
        out: rows.filter((x) => Number(x.quantity_on_hand) <= 0).length,
        transfers: t.count ?? 0,
      };
    },
  });
  const d = q.data;
  return <>
    <Link to="/inventory/stock"><Stat label="Inventory value" value={d ? inr(d.value) : "—"} hint="Weighted average cost" className="hover:border-primary/50" /></Link>
    <Link to="/inventory/stock"><Stat label="Low / out of stock" value={d ? `${d.low} / ${d.out}` : "—"} hint={d ? `${d.transfers} transfers in last 30 days` : undefined} className="hover:border-primary/50" /></Link>
  </>;
}

function Dashboard() {
  const can = useCan();
  const current = fyOf(new Date());
  const [fy, setFy] = useState(current);
  const [projectId, setProjectId] = useState("");
  const [buildingId, setBuildingId] = useState("");

  const q = useQuery({
    queryKey: ["dashboard", projectId, buildingId],
    queryFn: async () => {
      const pq = supabase.from("projects").select("id,name,code,status,budget,estimated_cost").order("name");
      let bq = supabase.from("buildings").select("id,name,project_id,budget");
      if (projectId) bq = bq.eq("project_id", projectId);
      const [p, b, v, i, w, a] = await Promise.all([
        pq,
        bq,
        supabase.from("vendors").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("items").select("id", { count: "exact", head: true }).eq("status", "active"),
        projectId ? supabase.from("warehouses").select("id", { count: "exact", head: true }).eq("status", "active").eq("project_id", projectId) : supabase.from("warehouses").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("audit_logs").select("id,action,entity,entity_id,created_at").order("created_at", { ascending: false }).limit(8),
      ]);
      for (const r of [p, b, v, i, w, a]) if (r.error) throw r.error;
      return { projects: p.data ?? [], buildings: b.data ?? [], vendors: v.count ?? 0, materials: i.count ?? 0, warehouses: w.count ?? 0, audit: a.data ?? [] };
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="text-sm text-destructive">{q.error.message}</div>;
  const d = q.data!;
  const scoped = projectId ? d.projects.filter((p) => p.id === projectId) : d.projects;
  const active = scoped.filter((p) => ["under_construction", "near_completion"].includes(p.status)).length;
  const building = d.buildings.find((b) => b.id === buildingId);
  const budget = building ? Number(building.budget) : scoped.reduce((s, p) => s + Number(p.budget), 0);
  const sel = "h-9 rounded-md border bg-background px-2 text-sm";

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${fyLabel(fy)} · 1 Apr ${fy} – 31 Mar ${fy + 1}`}
        actions={
          <>
            <select className={sel} value={fy} onChange={(e) => setFy(Number(e.target.value))} aria-label="Financial year">
              {[current + 1, current, current - 1, current - 2].map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}
            </select>
            <select className={sel} value={projectId} onChange={(e) => { setProjectId(e.target.value); setBuildingId(""); }} aria-label="Project">
              <option value="">All projects</option>
              {d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className={sel} value={buildingId} onChange={(e) => setBuildingId(e.target.value)} aria-label="Building" disabled={!projectId}>
              <option value="">All buildings</option>
              {d.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </>
        }
      />
      {can("purchase_request.view") && <PrSummary fy={fy} projectId={projectId} buildingId={buildingId} canCreate={can("purchase_request.create")} />}
      {can("purchase_order.view") && <PoSummary fy={fy} projectId={projectId} buildingId={buildingId} />}
      {can("grn.view") && <GrnSummary fy={fy} projectId={projectId} buildingId={buildingId} />}
      <Section title="Inventory">
        <Link to="/materials"><Stat label="Total materials" value={<span className="flex items-center justify-between">{d.materials}<Package className="h-5 w-5 text-primary" /></span>} hint="Active material master" className="hover:border-primary/50" /></Link>
        <Link to="/warehouses"><Stat label="Stores" value={<span className="flex items-center justify-between">{d.warehouses}<Warehouse className="h-5 w-5 text-primary" /></span>} hint={projectId ? "For selected project" : "All active stores"} className="hover:border-primary/50" /></Link>
        {can("inventory.view") ? <InvCards /> : <><Pending label="Inventory value" phase={4} /><Pending label="Low / out of stock" phase={4} /></>}
      </Section>
      <Section title="Vendors">
        <Link to="/vendors"><Stat label="Active vendors" value={<span className="flex items-center justify-between">{d.vendors}<Store className="h-5 w-5 text-primary" /></span>} hint="Supplier master" className="hover:border-primary/50" /></Link>
        {can("payable.view") ? <ApCards /> : <><Pending label="Vendor payables" phase={5} /><Pending label="Overdue bills" phase={5} /><Pending label="Payments this month" phase={5} /></>}
      </Section>
      <Section title="Projects">
        <Link to="/projects"><Stat label="Active projects" value={<span className="flex items-center justify-between">{active}<Building2 className="h-5 w-5 text-primary" /></span>} hint={`${scoped.length} total`} className="hover:border-primary/50" /></Link>
        <Stat label="Buildings" value={building ? 1 : d.buildings.length} hint={projectId ? "In selected project" : "All projects"} />
        {can("financial.view") ? <Stat label="Budget" value={inr(budget)} hint={building ? building.name : "Sum of project budgets"} /> : <div className="rounded-md border border-dashed bg-card p-4 text-xs text-muted-foreground">Budget hidden — no financial access</div>}
        <Pending label="Actual cost & variance" phase={6} />
      </Section>
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Recent activity</h2>
        <div className="rounded-md border bg-card">
          {d.audit.length === 0 && <div className="p-3 text-xs text-muted-foreground">No recorded activity yet.</div>}
          {d.audit.map((x) => <div key={x.id} className="grid grid-cols-[9rem_5rem_1fr] gap-3 border-b px-3 py-2 text-xs last:border-0"><span className="text-muted-foreground">{fmtDateTime(x.created_at)}</span><span className="font-medium capitalize">{x.action}</span><span className="truncate">{x.entity.replaceAll("_", " ")} <span className="font-mono text-muted-foreground">{x.entity_id}</span></span></div>)}
        </div>
      </section>
    </>
  );
}
