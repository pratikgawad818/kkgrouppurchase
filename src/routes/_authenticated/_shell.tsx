import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeftRight, Banknote, BookOpen, Boxes, Building, Building2, ChevronDown, ChevronsLeft, ChevronsRight, ClipboardList, ShieldCheck, FileClock, FileText, Layers, LayoutDashboard, LogOut, Menu, Package, Search, Receipt, Settings, ShoppingCart, Store, Truck, Users, Wallet, Warehouse } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/format";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen((v) => !v); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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

  const renderNav = (mini: boolean) => (
    <nav aria-label="Main navigation" className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn("flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border", mini ? "justify-center px-2" : "px-4")}>
        <div className={cn("grid shrink-0 place-items-center rounded-lg bg-card p-1 shadow-sm ring-1 ring-sidebar-border", mini ? "h-10 w-12" : "h-10 w-16")}><img src={brandMark.url} alt="KK Groups" className="h-full w-full object-contain" /></div>
        {!mini && <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold tracking-tight text-sidebar-accent-foreground">KK GROUP ERP</div>
          <div className="truncate text-[11px] text-sidebar-foreground/70">Real estate & construction</div>
        </div>}
      </div>
      <div className={cn("flex-1 overflow-y-auto py-3", mini ? "px-2" : "px-3")}>
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.perm || permissions.has(i.perm));
          if (!items.length) return null;
          return (
            <div key={g.group} className="mb-2">
              {mini ? <div className="mx-auto my-2 h-px w-6 bg-sidebar-border" aria-hidden /> : <div className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/55">{g.group}</div>}
              {items.map((i) => {
                const active = path === i.to || path.startsWith(i.to + "/");
                return (
                  <Link
                    key={i.to}
                    to={i.to}
                    onClick={() => setOpen(false)}
                    title={mini ? i.label : undefined}
                    aria-label={mini ? i.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex min-h-9 items-center gap-3 rounded-lg text-[13.5px] font-medium transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:outline-sidebar-ring",
                      mini ? "justify-center px-0 py-2" : "px-3 py-2",
                      active && "bg-sidebar-accent text-sidebar-accent-foreground",
                    )}
                  >
                    {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-sidebar-primary" />}
                    <i.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-sidebar-primary" : "text-sidebar-foreground/75 group-hover:text-sidebar-accent-foreground")} />
                    {!mini && <span className="truncate">{i.label}</span>}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className={cn("shrink-0 border-t border-sidebar-border p-3", mini && "flex justify-center")}>
        {mini ? (
          <button onClick={signOut} aria-label="Sign out" title="Sign out" className="grid h-9 w-9 place-items-center rounded-lg text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><LogOut className="h-4 w-4" /></button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground ring-1 ring-brass/40">{initials(profile.full_name ?? profile.email ?? "")}</span>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-sidebar-accent-foreground">{profile.full_name ?? profile.email}</div>
              <div className="truncate text-[11px] text-sidebar-foreground/65">{roles.map((r) => ROLE_LABEL[r]).join(", ") || "No role assigned"}</div></div>
            <button onClick={signOut} aria-label="Sign out" title="Sign out" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><LogOut className="h-4 w-4" /></button>
          </div>
        )}
      </div>
    </nav>
  );
  const items = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || permissions.has(i.perm)) })).filter((g) => g.items.length);
  const groupFor = items.find((g) => g.items.some((i) => path === i.to || path.startsWith(i.to + "/")))?.group;

  const blocked = !profile.is_active
    ? "Your account has been deactivated. Contact your administrator."
    : roles.length === 0
      ? "Your account is awaiting access. An administrator needs to assign you a role before you can use the system."
      : null;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className={cn("sticky top-0 hidden h-screen shrink-0 transition-[width] duration-200 print:!hidden lg:block", collapsed ? "w-[72px]" : "w-64")}>{renderNav(collapsed)}</aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[280px] max-w-[85vw] border-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {renderNav(false)}
        </SheetContent>
      </Sheet>
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder="Jump to a page…" />
        <CommandList>
          <CommandEmpty>No matching page.</CommandEmpty>
          {items.map((g) => (
            <CommandGroup key={g.group} heading={g.group}>
              {g.items.map((i) => (
                <CommandItem key={i.to} value={`${g.group} ${i.label}`} onSelect={() => { setSearchOpen(false); navigate({ to: i.to }); }}>
                  <i.icon className="h-4 w-4 text-muted-foreground" />{i.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-card/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/75 print:hidden sm:gap-3 md:h-16 md:px-6">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu" className="h-11 w-11 lg:hidden"><Menu className="h-5 w-5" /></Button>
          <Link to="/dashboard" className="shrink-0 lg:hidden" aria-label="KK GROUP ERP home"><img src={brandMark.url} alt="KK Groups" className="h-8 w-auto object-contain" /></Link>
          <Button variant="ghost" size="icon" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} className="hidden text-muted-foreground lg:inline-flex">{collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}</Button>
          <div className="min-w-0 flex-1">
            {groupFor && <div className="hidden text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground md:block">{groupFor}</div>}
            <h1 className="truncate text-sm font-semibold tracking-tight md:text-[15px]">{titleFor(path)}</h1>
          </div>
          <button onClick={() => setSearchOpen(true)} className="hidden h-9 w-60 items-center gap-2 rounded-lg border bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground md:flex">
            <Search className="h-4 w-4" /><span className="flex-1 text-left">Go to page…</span><kbd className="rounded border bg-muted px-1.5 font-mono text-[10px]">⌘K</kbd>
          </button>
          <Button variant="ghost" size="icon" onClick={() => setSearchOpen(true)} aria-label="Go to page" className="h-11 w-11 md:hidden"><Search className="h-5 w-5" /></Button>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex min-h-11 items-center gap-2 rounded-lg px-1.5 hover:bg-muted md:min-h-9" aria-label="Account menu">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials(profile.full_name ?? profile.email ?? "")}</span>
              <span className="hidden max-w-40 truncate text-sm font-medium xl:block">{profile.full_name ?? profile.email}</span>
              <ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:block" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel><div className="truncate">{profile.full_name ?? profile.email}</div><div className="truncate text-xs font-normal text-muted-foreground">{roles.map((r) => ROLE_LABEL[r]).join(", ") || "No role assigned"}</div></DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate({ to: "/settings/company" })}><Settings className="h-4 w-4" />Company settings</DropdownMenuItem>
              <DropdownMenuItem onSelect={signOut}><LogOut className="h-4 w-4" />Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
         <main className="mx-auto w-full max-w-[1600px] px-4 py-5 md:px-6 lg:px-8 lg:py-7">
          {blocked ? <div className="rounded-md border bg-card p-6 text-sm">{blocked}</div> : <Outlet />}
        </main>
      </div>
    </div>
  );
}
