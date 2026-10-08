import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeftRight, Banknote, BookOpen, Boxes, Building, Building2, ChevronDown, ChevronsLeft, ChevronsRight, ClipboardList, ShieldCheck, FileClock, FileText, Layers, LayoutDashboard, LogOut, Menu, Package, Receipt, Settings, ShoppingCart, Store, Truck, Users, Wallet, Warehouse } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; perm?: string };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Overview", items: [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/projects", label: "Projects", icon: Building2 },
    { to: "/buildings", label: "Buildings", icon: Building },
    { to: "/units", label: "Property Inventory", icon: Boxes },
  ] },
  { group: "Approvals", items: [
    { to: "/approvals", label: "Director Approvals", icon: ShieldCheck },
  ] },
  { group: "Procurement", items: [
    { to: "/procurement/purchase-requests", label: "Purchase Requests", icon: ClipboardList, perm: "purchase_request.view" },
    { to: "/procurement/rfqs", label: "RFQs & Quotations", icon: FileText, perm: "rfq.view" },
    { to: "/procurement/vendor-quotations", label: "Vendor Quotations", icon: FileText, perm: "quotation.view" },
    { to: "/procurement/purchase-orders", label: "Purchase Orders", icon: ShoppingCart, perm: "purchase_order.view" },
    { to: "/inventory/delivery-challans", label: "Delivery Challans", icon: FileText, perm: "grn.view" },
    { to: "/inventory/goods-received", label: "Goods Received", icon: Truck, perm: "grn.view" },
  ] },
  { group: "Materials & Stores", items: [
    { to: "/materials", label: "Materials", icon: Package, perm: "materials.view" },
    { to: "/vendors", label: "Vendors", icon: Store, perm: "vendors.view" },
    { to: "/warehouses", label: "Warehouses", icon: Warehouse, perm: "warehouses.view" },
    { to: "/inventory/stock", label: "Stock", icon: Layers, perm: "inventory.view" },
    { to: "/inventory/stock-movements", label: "Stock Movements", icon: ArrowLeftRight, perm: "inventory.view" },
    { to: "/inventory/material-issues", label: "Material Issues & Returns", icon: Package, perm: "inventory.view" },
    { to: "/inventory/material-consumption", label: "Project Consumption", icon: BookOpen, perm: "inventory.view" },
  ] },
  { group: "Finance", items: [
    { to: "/finance/vendor-invoices", label: "Vendor Invoices", icon: Receipt, perm: "vendor_invoice.view" },
    { to: "/finance/payables", label: "Accounts Payable", icon: Wallet, perm: "payable.view" },
    { to: "/finance/payments", label: "Vendor Payments", icon: Banknote, perm: "payment.view" },
    { to: "/finance/vendor-ledger", label: "Vendor Ledger", icon: BookOpen, perm: "ledger.view" },
  ] },
  { group: "Administration", items: [
    { to: "/settings/users", label: "Users & Roles", icon: Users, perm: "users.manage" },
    { to: "/settings/company", label: "Company Settings", icon: Settings },
    { to: "/settings/finance", label: "Finance Settings", icon: Settings, perm: "company.view" },
    { to: "/audit", label: "Audit Log", icon: FileClock, perm: "audit.view" },
  ] },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);
function titleFor(path: string) {
  const m = ALL_ITEMS.filter((i) => path === i.to || path.startsWith(i.to + "/")).sort((a, b) => b.to!.length - a.to!.length)[0];
  return m?.label ?? "KK GROUP ERP";
}
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "U"; }

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
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-4">
         <div className="grid h-10 w-16 shrink-0 place-items-center rounded-sm bg-card p-0.5"><img src={brandMark.url} alt="KK Groups" className="h-full w-full object-contain" /></div>
        <div className={cn("leading-tight", collapsed && "lg:hidden")}>
          <div className="text-sm font-semibold text-sidebar-accent-foreground">KK GROUP ERP</div>
          <div className="text-[11px] text-sidebar-foreground/70">Real estate & construction</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.perm || permissions.has(i.perm));
          if (!items.length) return null;
          return (
            <div key={g.group || "top"} className="mb-3">
               {g.group && <div className={cn("px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/60", collapsed && "lg:hidden")}>{g.group}</div>}
              {items.map((i) => {
                const active = path === i.to || path.startsWith(i.to + "/");
                return (
                  <Link
                    key={i.to}
                    to={i.to}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground",
                      active && "bg-sidebar-accent text-sidebar-accent-foreground",
                    )}
                  >
                    <i.icon className="h-[18px] w-[18px] shrink-0" />
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
      <aside className={cn("sticky top-0 hidden h-screen print:!hidden shrink-0 border-r transition-[width] lg:block", collapsed ? "w-16" : "w-64")}>{nav}</aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 border-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {nav}
        </SheetContent>
      </Sheet>
       <div className="min-w-0 flex-1">
         <div className="sticky top-0 z-20 flex h-16 print:hidden items-center gap-3 border-b bg-card/95 px-4 backdrop-blur md:px-6">
           <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu" className="lg:hidden"><Menu className="h-5 w-5" /></Button>
           <Button variant="ghost" size="icon" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="hidden lg:inline-flex">{collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}</Button>
           <h1 className="flex-1 truncate text-base font-semibold">{titleFor(path)}</h1>
           <DropdownMenu>
             <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
               <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{initials(profile.full_name ?? profile.email ?? "")}</span>
               <span className="hidden max-w-40 truncate text-sm font-medium sm:block">{profile.full_name ?? profile.email}</span>
               <ChevronDown className="h-4 w-4 text-muted-foreground" />
             </DropdownMenuTrigger>
             <DropdownMenuContent align="end" className="w-56">
               <DropdownMenuLabel><div className="truncate">{profile.full_name ?? profile.email}</div><div className="truncate text-xs font-normal text-muted-foreground">{roles.map((r) => ROLE_LABEL[r]).join(", ") || "No role assigned"}</div></DropdownMenuLabel>
               <DropdownMenuSeparator />
               <DropdownMenuItem onSelect={() => navigate({ to: "/settings/company" })}>Company settings</DropdownMenuItem>
               <DropdownMenuItem onSelect={signOut}><LogOut className="h-4 w-4" />Sign out</DropdownMenuItem>
             </DropdownMenuContent>
           </DropdownMenu>
        </div>
         <main className="mx-auto max-w-[1600px] p-4 md:p-5 lg:p-6">
          {blocked ? <div className="rounded-md border bg-card p-6 text-sm">{blocked}</div> : <Outlet />}
        </main>
      </div>
    </div>
  );
}
