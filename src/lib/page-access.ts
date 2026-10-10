import { VIEWER_NAV } from "./management-overview";

/**
 * UI authorization boundary for authenticated routes. Do not rely on sidebar
 * hiding: deep links and nested /new, /edit and /quotation paths also pass
 * through this check before their page components mount.
 *
 * This is defense-in-depth; table RLS and privileged RPCs MUST independently
 * enforce each permission, document scope and actor identity.
 */
type Rule = { pattern: RegExp; any?: readonly string[]; all?: readonly string[] };
export type PageAccess = {
  roles: readonly string[];
  permissions: ReadonlySet<string>;
};

const rules: readonly Rule[] = [
  { pattern: /^\/dashboard\/?$/ },
  { pattern: /^\/management\/?$/, all: ["inventory.view", "payable.view", "payment.view"] },
  { pattern: /^\/projects\/?$/, any: ["projects.view_all", "projects.manage", "purchase_request.view", "inventory.view", "units.view"] },
  { pattern: /^\/buildings\/?$/, any: ["projects.view_all", "buildings.manage", "inventory.view", "purchase_request.view", "units.view"] },
  { pattern: /^\/units\/?$/, any: ["units.view"] },
  { pattern: /^\/approvals\/?$/, any: ["purchase_order.approve", "payment.approve", "users.manage"] },

  { pattern: /^\/procurement\/follow-ups\/?$/, any: ["purchase_order.view"] },
  { pattern: /^\/procurement\/supplier-rate-history\/?$/, any: ["purchase_order.view"] },
  { pattern: /^\/procurement\/purchase-requests\/new\/?$/, any: ["purchase_request.create"] },
  { pattern: /^\/procurement\/purchase-requests\/[^/]+\/edit\/?$/, any: ["purchase_request.edit"] },
  { pattern: /^\/procurement\/purchase-requests(?:\/[^/]+)?\/?$/, any: ["purchase_request.view"] },
  { pattern: /^\/procurement\/rfqs\/new\/?$/, any: ["rfq.create"] },
  { pattern: /^\/procurement\/rfqs\/[^/]+\/quotation\/?$/, any: ["quotation.create", "quotation.edit"] },
  { pattern: /^\/procurement\/rfqs\/[^/]+\/compare\/?$/, any: ["quotation.compare"] },
  { pattern: /^\/procurement\/rfqs(?:\/[^/]+)?\/?$/, any: ["rfq.view"] },
  { pattern: /^\/procurement\/vendor-quotations\/?$/, any: ["quotation.view"] },
  { pattern: /^\/procurement\/purchase-orders(?:\/[^/]+)?\/?$/, any: ["purchase_order.view"] },

  { pattern: /^\/inventory\/delivery-challans(?:\/[^/]+)?\/?$/, any: ["grn.view"] },
  { pattern: /^\/inventory\/goods-received(?:\/[^/]+)?\/?$/, any: ["grn.view"] },
  { pattern: /^\/inventory\/stock\/?$/, any: ["inventory.view"] },
  { pattern: /^\/inventory\/reorder-planning\/?$/, any: ["inventory.view"] },
  { pattern: /^\/inventory\/stock-movements\/?$/, any: ["inventory.view"] },
  { pattern: /^\/inventory\/material-issues(?:\/[^/]+)?\/?$/, any: ["inventory.view"] },
  { pattern: /^\/inventory\/material-consumption\/?$/, any: ["inventory.view"] },
  { pattern: /^\/materials\/?$/, any: ["materials.view"] },
  { pattern: /^\/vendors\/?$/, any: ["vendors.view"] },
  { pattern: /^\/warehouses\/?$/, any: ["warehouses.view"] },

  { pattern: /^\/reports\/project-cost-control\/?$/, any: ["financial.view"] },
  { pattern: /^\/finance\/vendor-invoices\/new\/?$/, any: ["vendor_invoice.create"] },
  { pattern: /^\/finance\/vendor-invoices(?:\/[^/]+)?\/?$/, any: ["vendor_invoice.view"] },
  { pattern: /^\/finance\/payables\/?$/, any: ["payable.view"] },
  { pattern: /^\/finance\/payments\/?$/, any: ["payment.view"] },
  { pattern: /^\/finance\/vendor-ledger\/?$/, any: ["ledger.view"] },

  { pattern: /^\/settings\/users\/?$/, any: ["users.manage"] },
  { pattern: /^\/settings\/company\/?$/, any: ["company.view", "company.manage"] },
  { pattern: /^\/settings\/finance\/?$/, any: ["company.view", "company.manage"] },
  { pattern: /^\/audit\/?$/, any: ["audit.view"] },
];

export function canAccessPage(path: string, user: PageAccess): boolean {
  if (!user.roles.length) return false;
  // A single Management Viewer role must NEVER inherit the operational
  // dashboard, staff settings, approval flows, or document detail edit forms.
  if (user.roles.length === 1 && user.roles[0] === "auditor" &&
      !VIEWER_NAV.has(path.replace(/\/$/, ""))) return false;
  const rule = rules.find(entry => entry.pattern.test(path));
  if (!rule) return false; // New routes fail closed until deliberately classified.
  if (rule.all && !rule.all.every(p => user.permissions.has(p))) return false;
  if (rule.any && !rule.any.some(p => user.permissions.has(p))) return false;
  return true;
}

export function accessibleNavigation<T extends { to: string }>(
  items: readonly T[], user: PageAccess,
): T[] {
  return items.filter(item => canAccessPage(item.to, user));
}
