import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, Package, Store, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "KK Group ERP — Procurement & Operations" },
      { name: "description", content: "Internal ERP for KK Group projects, vendors, materials, warehouses and controlled operations." },
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
    { icon: Building2, t: "Projects", d: "Project locations, budgets, teams and construction hierarchy." },
    { icon: Store, t: "Vendors", d: "Approved supplier identities, categories, tax details and terms." },
    { icon: Package, t: "Materials & stores", d: "Controlled material masters, units, thresholds and locations." },
    { icon: ShieldCheck, t: "Role-based access", d: "Operational roles, granular permissions and audit history." },
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
           <p className="font-mono text-xs uppercase tracking-[0.2em] text-sidebar-primary">Internal construction operations</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-sidebar-accent-foreground md:text-5xl">
             Every material and every rupee, traceable end to end.
          </h1>
          <p className="mt-5 max-w-xl text-base text-sidebar-foreground/80">
             A controlled foundation for projects, vendors, materials, stores, procurement and project costing.
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
