import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Building, Building2, FileClock, LayoutDashboard, LayoutGrid, LogOut, Menu, Settings, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/format";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/erp/common";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_shell")({
  component: Shell,
});

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; perm?: string };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Overview", items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    group: "Projects",
    items: [
      { to: "/projects", label: "Projects", icon: Building2 },
      { to: "/buildings", label: "Buildings", icon: Building },
      { to: "/units", label: "Unit Inventory", icon: LayoutGrid, perm: "units.view" },
    ],
  },
  {
    group: "Administration",
    items: [
      { to: "/settings/users", label: "Users & Permissions", icon: Users, perm: "users.manage" },
      { to: "/audit", label: "Audit Log", icon: FileClock, perm: "audit.view" },
      { to: "/settings/company", label: "Company Settings", icon: Settings },
    ],
  },
];

function Shell() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (me.isLoading) return <Loading />;
  if (me.error) return <div className="p-8 text-sm text-destructive">Could not load your profile: {me.error.message}</div>;
  const { profile, roles, permissions } = me.data!;

  const nav = (
    <nav className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-sm bg-sidebar-primary font-mono text-sm font-bold text-sidebar-primary-foreground">KK</div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-sidebar-accent-foreground">KK Group</div>
          <div className="text-[11px] text-sidebar-foreground/60">Developer ERP</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.perm || permissions.has(i.perm));
          if (!items.length) return null;
          return (
            <div key={g.group} className="mb-4">
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">{g.group}</div>
              {items.map((i) => {
                const active = path === i.to || path.startsWith(i.to + "/");
                return (
                  <Link
                    key={i.to}
                    to={i.to}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_2px_0_0_var(--sidebar-primary)]",
                    )}
                  >
                    <i.icon className="h-4 w-4 shrink-0" />
                    {i.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="border-t border-sidebar-border p-3">
        <div className="truncate text-sm font-medium text-sidebar-accent-foreground">{profile.full_name ?? profile.email}</div>
        <div className="truncate text-[11px] text-sidebar-foreground/60">{roles.map((r) => ROLE_LABEL[r]).join(", ") || "No role assigned"}</div>
        <button onClick={signOut} className="mt-2 flex items-center gap-1.5 text-xs text-sidebar-foreground/70 hover:text-sidebar-accent-foreground">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </nav>
  );

  const blocked = !profile.is_active
    ? "Your account has been deactivated. Contact your administrator."
    : roles.length === 0
      ? "Your account is awaiting access. An administrator needs to assign you a role before you can use the system."
      : null;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 lg:block">{nav}</aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 border-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {nav}
        </SheetContent>
      </Sheet>
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></Button>
          <span className="font-semibold">KK Group ERP</span>
        </div>
        <main className="mx-auto max-w-[1400px] p-4 md:p-6 lg:p-8">
          {blocked ? <div className="rounded-md border bg-card p-6 text-sm">{blocked}</div> : <Outlet />}
        </main>
      </div>
    </div>
  );
}
