import { canAccessPage, type PageAccess } from "./page-access.ts";

export type WorkspaceNavItem = { to: string; label: string };
export type WorkspaceNavGroup = { key: string; label: string; items: WorkspaceNavItem[] };

export const WORKSPACE_NAV: WorkspaceNavGroup[] = [
  { key: "home", label: "Overview", items: [{ to: "/dashboard", label: "Dashboard" }] },
  {
    key: "purchasing",
    label: "Procurement",
    items: [
      { to: "/procurement/purchase-requests", label: "Purchase requests" },
      { to: "/procurement/rfqs", label: "RFQs & quotations" },
      { to: "/procurement/vendor-quotations", label: "Vendor quotations" },
      { to: "/procurement/purchase-orders", label: "Purchase orders" },
      { to: "/procurement/follow-ups", label: "Supplier follow-ups" },
      { to: "/procurement/supplier-rate-history", label: "Supplier price history" },
      { to: "/vendors", label: "Vendors" },
    ],
  },
  {
    key: "stock",
    label: "Inventory",
    items: [
      { to: "/inventory/stock", label: "Stock on hand" },
      { to: "/inventory/reorder-planning", label: "Low stock & reorder" },
      { to: "/inventory/delivery-challans", label: "Delivery challans" },
      { to: "/inventory/goods-received", label: "Goods received" },
      { to: "/inventory/stock-movements", label: "Stock movements" },
      { to: "/inventory/material-issues", label: "Material issues & returns" },
      { to: "/inventory/material-consumption", label: "Project consumption" },
      { to: "/materials", label: "Materials" },
      { to: "/warehouses", label: "Warehouses" },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    items: [
      { to: "/finance/payments", label: "Vendor payments" },
      { to: "/finance/vendor-invoices", label: "Vendor invoices" },
      { to: "/finance/payables", label: "Accounts payable" },
      { to: "/finance/vendor-ledger", label: "Vendor ledger" },
      { to: "/finance/small-expenses", label: "Small expenses" },
      { to: "/reports/project-cost-control", label: "Project cost control" },
    ],
  },
  {
    key: "approvals",
    label: "Approvals",
    items: [{ to: "/approvals", label: "Director approvals" }],
  },
  {
    key: "projects",
    label: "Projects",
    items: [
      { to: "/projects", label: "Projects" },
      { to: "/buildings", label: "Buildings" },
      { to: "/units", label: "Property inventory" },
      { to: "/management", label: "Management overview" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    items: [
      { to: "/profile", label: "My profile" },
      { to: "/settings/users", label: "Users & roles" },
      { to: "/settings/company", label: "Company settings" },
      { to: "/settings/finance", label: "Finance settings" },
      { to: "/audit", label: "Audit log" },
    ],
  },
];

export function workspaceNavigation(access: PageAccess): WorkspaceNavGroup[] {
  const nav =
    access.roles.length === 1 && access.roles[0] === "auditor"
      ? WORKSPACE_NAV.map((group) =>
          group.key === "home"
            ? { ...group, items: [{ to: "/management", label: "Management overview" }] }
            : { ...group, items: group.items.filter((item) => item.to !== "/management") },
        )
      : WORKSPACE_NAV;
  return nav
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessPage(item.to, access)),
    }))
    .filter((group) => group.items.length > 0);
}

export function workspaceLocation(path: string, groups: WorkspaceNavGroup[]) {
  return groups
    .flatMap((group) => group.items.map((item) => ({ group, item })))
    .filter(({ item }) => path === item.to || path.startsWith(item.to + "/"))
    .sort((a, b) => b.item.to.length - a.item.to.length)[0];
}

/** Choose shortcuts only from already-authorized routes. Directors review work first. */
export function mobileWorkspaceNavigation(groups: WorkspaceNavGroup[], isDirector = false) {
  const keys = isDirector
    ? ["home", "approvals", "purchasing", "finance"]
    : ["home", "purchasing", "stock", "finance"];
  return keys.flatMap((key) => {
    const group = groups.find((entry) => entry.key === key);
    if (!group) return [];
    const target =
      isDirector && key === "purchasing"
        ? group.items.find((item) => item.to === "/procurement/purchase-orders")
        : group.items[0];
    if (!target) return [];
    const label =
      key === "home"
        ? "Home"
        : key === "approvals"
          ? "Approvals"
          : key === "purchasing"
            ? isDirector
              ? "Orders"
              : "Purchasing"
            : key === "stock"
              ? "Stock"
              : "Payments";
    return [{ key, to: target.to, label }];
  });
}
