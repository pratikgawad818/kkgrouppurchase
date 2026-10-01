import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, Layers, LayoutGrid, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "KK Group ERP — Projects, Inventory & Sales" },
      { name: "description", content: "Internal ERP for KK Group: projects, buildings, floors and unit inventory with role-based access." },
      { property: "og:title", content: "KK Group ERP" },
      { property: "og:description", content: "Internal ERP for KK Group real estate development." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const items = [
    { icon: Building2, t: "Projects & RERA", d: "Project master with approvals, consultants and RERA validity." },
    { icon: Layers, t: "Buildings & floors", d: "Wing-wise structure, budgets and construction status." },
    { icon: LayoutGrid, t: "Unit inventory", d: "Every flat, shop and office priced and tracked by status." },
    { icon: ShieldCheck, t: "Role-based access", d: "Nine roles, granular permissions, full audit trail." },
  ];
  return (
    <div className="min-h-screen bg-sidebar text-sidebar-foreground">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-sm bg-sidebar-primary font-mono text-sm font-bold text-sidebar-primary-foreground">KK</div>
            <span className="font-semibold tracking-tight text-sidebar-accent-foreground">KK Group ERP</span>
          </div>
          <Button asChild size="sm" className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90">
            <Link to="/dashboard">Sign in</Link>
          </Button>
        </header>
        <main className="flex flex-1 flex-col justify-center py-16">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-sidebar-primary">Real estate development ERP</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-sidebar-accent-foreground md:text-5xl">
            From land parcel to possession — one system of record.
          </h1>
          <p className="mt-5 max-w-xl text-base text-sidebar-foreground/80">
            Projects, wings, floors and every unit's price and status, governed by roles and audited end to end.
          </p>
          <div className="mt-8">
            <Button asChild size="lg" className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90">
              <Link to="/dashboard">Open workspace</Link>
            </Button>
          </div>
          <div className="mt-16 grid gap-px overflow-hidden rounded-md border border-sidebar-border bg-sidebar-border sm:grid-cols-2 lg:grid-cols-4">
            {items.map((i) => (
              <div key={i.t} className="bg-sidebar p-5">
                <i.icon className="h-5 w-5 text-sidebar-primary" />
                <div className="mt-3 font-medium text-sidebar-accent-foreground">{i.t}</div>
                <div className="mt-1 text-sm text-sidebar-foreground/70">{i.d}</div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
