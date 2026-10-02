import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Building2, Package, Store, Warehouse } from "lucide-react";
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

function Dashboard() {
  const can = useCan();
  const current = fyOf(new Date());
  const [fy, setFy] = useState(current);
  const [projectId, setProjectId] = useState("");
  const [buildingId, setBuildingId] = useState("");

  const q = useQuery({
    queryKey: ["dashboard", projectId, buildingId],
    queryFn: async () => {
      let pq = supabase.from("projects").select("id,name,code,status,budget,estimated_cost").order("name");
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
      <Section title="Purchase">
        <Pending label="Purchase requests pending" phase={2} />
        <Pending label="Open purchase orders" phase={3} />
        <Pending label="Purchases this month" phase={3} />
        <Pending label={`Purchases ${fyLabel(fy)}`} phase={3} />
      </Section>
      <Section title="Inventory">
        <Link to="/materials"><Stat label="Total materials" value={<span className="flex items-center justify-between">{d.materials}<Package className="h-5 w-5 text-primary" /></span>} hint="Active material master" className="hover:border-primary/50" /></Link>
        <Link to="/warehouses"><Stat label="Stores" value={<span className="flex items-center justify-between">{d.warehouses}<Warehouse className="h-5 w-5 text-primary" /></span>} hint={projectId ? "For selected project" : "All active stores"} className="hover:border-primary/50" /></Link>
        <Pending label="Inventory value" phase={4} />
        <Pending label="Low / out of stock" phase={4} />
      </Section>
      <Section title="Vendors">
        <Link to="/vendors"><Stat label="Active vendors" value={<span className="flex items-center justify-between">{d.vendors}<Store className="h-5 w-5 text-primary" /></span>} hint="Supplier master" className="hover:border-primary/50" /></Link>
        <Pending label="Vendor payables" phase={5} />
        <Pending label="Overdue bills" phase={5} />
        <Pending label="Payments this month" phase={5} />
      </Section>
      <Section title="Projects">
        <Link to="/projects"><Stat label="Active projects" value={<span className="flex items-center justify-between">{active}<Building2 className="h-5 w-5 text-primary" /></span>} hint={`${scoped.length} total`} className="hover:border-primary/50" /></Link>
        <Stat label="Buildings" value={building ? 1 : d.buildings.length} hint={projectId ? "In selected project" : "All projects"} />
        {can("financial.view") ? <Stat label="Budget" value={inr(budget)} hint={building ? building.name : "Sum of project budgets"} /> : <Pending label="Budget" phase={1} />}
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
