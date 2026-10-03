import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeftRight, Banknote, BarChart3, BookOpen, Boxes, Building, Building2, Calculator, ChevronsLeft, ChevronsRight, ClipboardList, FileClock, FileText, FolderOpen, Layers, LayoutDashboard, LogOut, Menu, Package, PackageMinus, Receipt, Settings, ShoppingCart, Store, Truck, Undo2, Users, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/format";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/erp/common";
import { cn } from "@/lib/utils";
import brandMark from "@/assets/kk-groups-full.png.asset.json";

export const Route = createFileRoute("/_authenticated/_shell")({
  component: Shell,
});

type NavItem = { to?: string; label: string; icon: typeof LayoutDashboard; perm?: string; phase?: number };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Overview", items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  { group: "Procurement", items: [
    { to: "/procurement/purchase-requests", label: "Purchase Requests", icon: ClipboardList, perm: "purchase_request.view" },
    { to: "/procurement/rfqs", label: "RFQs", icon: FileText, perm: "rfq.view" },
    { to: "/procurement/vendor-quotations", label: "Vendor Quotations", icon: FileText, perm: "quotation.view" },
    { to: "/procurement/purchase-orders", label: "Purchase Orders", icon: ShoppingCart, perm: "purchase_order.view" },
    { to: "/inventory/goods-received", label: "Goods Received", icon: Truck, perm: "grn.view" },
    { to: "/finance/vendor-invoices", label: "Vendor Invoices", icon: Receipt, perm: "vendor_invoice.view" },
  ] },
  { group: "Inventory", items: [
    { to: "/materials", label: "Materials", icon: Package, perm: "materials.view" },
    { to: "/warehouses", label: "Warehouses", icon: Boxes, perm: "warehouses.view" },
    { to: "/inventory/stock", label: "Stock", icon: Layers, perm: "inventory.view" },
    { to: "/inventory/stock-movements", label: "Stock Movements", icon: ArrowLeftRight, perm: "inventory.view" },
    { label: "Material Issues", icon: PackageMinus, phase: 5 },
    
    { label: "Returns", icon: Undo2, phase: 5 },
  ] },
  { group: "Vendors", items: [
    { to: "/vendors", label: "Vendor Master", icon: Store, perm: "vendors.view" },
    { to: "/finance/vendor-ledger", label: "Vendor Ledger", icon: BookOpen, perm: "ledger.view" },
    { to: "/finance/payments", label: "Vendor Payments", icon: Banknote, perm: "payment.view" },
  ] },
  { group: "Projects", items: [
    { to: "/projects", label: "Projects", icon: Building2 },
    { to: "/buildings", label: "Buildings", icon: Building },
    { label: "Project Costing", icon: Calculator, phase: 6 },
    { label: "Building Costing", icon: Calculator, phase: 6 },
  ] },
  { group: "Finance & Accounting", items: [
    { to: "/finance/payables", label: "Accounts Payable", icon: Wallet, perm: "payable.view" },
    { label: "Chart of Accounts", icon: BookOpen, phase: 6 },
    { label: "Journal Entries", icon: BookOpen, phase: 6 },
    { label: "Trial Balance", icon: BarChart3, phase: 6 },
  ] },
  { group: "Insights", items: [
    { label: "Reports", icon: BarChart3, phase: 7 },
    { label: "Documents", icon: FolderOpen, phase: 7 },
  ] },
  { group: "Administration", items: [
    { to: "/settings/users", label: "Users & Permissions", icon: Users, perm: "users.manage" },
    { to: "/settings/company", label: "Company Settings", icon: Settings },
    { to: "/settings/finance", label: "Finance Settings", icon: Settings, perm: "company.view" },
    { to: "/audit", label: "Audit Log", icon: FileClock, perm: "audit.view" },
  ] },
];

function Shell() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setCollapsed(window.localStorage.getItem("kk-sidebar-collapsed") === "1"), []);
  function toggleCollapsed() { setCollapsed((value) => { window.localStorage.setItem("kk-sidebar-collapsed", value ? "0" : "1"); return !value; }); }

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
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-3">
         <div className="grid h-10 w-16 shrink-0 place-items-center rounded-sm bg-card p-0.5"><img src={brandMark.url} alt="KK Groups" className="h-full w-full object-contain" /></div>
        <div className={cn("leading-tight", collapsed && "lg:hidden")}>
          <div className="text-sm font-semibold text-sidebar-accent-foreground">KK GROUP ERP</div>
          <div className="text-[11px] text-sidebar-foreground/60">Procurement & Projects</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.perm || permissions.has(i.perm));
          if (!items.length) return null;
          return (
            <div key={g.group} className="mb-4">
               <div className={cn("px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50", collapsed && "lg:hidden")}>{g.group}</div>
              {items.map((i) => {
                if (!i.to) {
                  return (
                    <div key={i.label} title={`Coming in Phase ${i.phase}`} className="flex cursor-default items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-sidebar-foreground/40">
                      <i.icon className="h-4 w-4 shrink-0" />
                      <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>{i.label}</span>
                      <span className={cn("rounded-sm border border-sidebar-border px-1 text-[9px] font-semibold", collapsed && "lg:hidden")}>P{i.phase}</span>
                    </div>
                  );
                }
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
                    <span className={cn(collapsed && "lg:hidden")}>{i.label}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="border-t border-sidebar-border p-3">
         <div className={cn(collapsed && "lg:hidden")}><div className="truncate text-sm font-medium text-sidebar-accent-foreground">{profile.full_name ?? profile.email}</div>
         <div className="truncate text-[11px] text-sidebar-foreground/60">{roles.map((r) => ROLE_LABEL[r]).join(", ") || "No role assigned"}</div></div>
        <button onClick={signOut} className="mt-2 flex items-center gap-1.5 text-xs text-sidebar-foreground/70 hover:text-sidebar-accent-foreground">
           <LogOut className="h-3.5 w-3.5" /> <span className={cn(collapsed && "lg:hidden")}>Sign out</span>
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
    <div className="flex min-h-screen bg-background">
      <aside className={cn("sticky top-0 hidden h-screen print:!hidden shrink-0 border-r transition-[width] lg:block", collapsed ? "w-16" : "w-60")}>{nav}</aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 border-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {nav}
        </SheetContent>
      </Sheet>
       <div className="min-w-0 flex-1">
         <div className="sticky top-0 z-20 flex h-14 print:hidden items-center gap-3 border-b bg-card px-4">
           <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu" className="lg:hidden"><Menu className="h-5 w-5" /></Button>
           <Button variant="ghost" size="icon" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="hidden lg:inline-flex">{collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}</Button>
           <div className="flex-1 text-sm font-medium text-muted-foreground">KK GROUP ERP</div>
           <div className="hidden text-right sm:block"><div className="max-w-40 truncate text-xs font-medium">{profile.full_name ?? profile.email}</div><div className="max-w-40 truncate text-[10px] text-muted-foreground">{roles.map((r) => ROLE_LABEL[r]).join(", ")}</div></div>
        </div>
         <main className="mx-auto max-w-[1600px] p-4 md:p-5 lg:p-6">
          {blocked ? <div className="rounded-md border bg-card p-6 text-sm">{blocked}</div> : <Outlet />}
        </main>
      </div>
    </div>
  );
}
