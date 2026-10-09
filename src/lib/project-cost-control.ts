/**
 * Operational project cost indicators for construction builders.
 *
 * Material consumption, open PO commitments and approved vendor invoices are
 * DISTINCT accounting stages; NEVER add them into a single "project spend"
 * number because they overlap. This report is NOT a project P&L.
 */
import { ACTIVE_DELIVERY_PO_STATUSES, purchaseOrderLineValues, type FollowupPoLine } from "./procurement-followup";

export type CostProject = {
  id: string;
  name: string;
  code: string;
  budget: number;
  estimated_cost: number;
  status: string;
};

export type CostPurchaseOrder = {
  project_id: string;
  status: string;
  purchase_order_items: FollowupPoLine[];
};

export type CostMaterial = {
  project_id: string;
  net_value: number;
};

export type CostVendorInvoice = {
  project_id: string;
  status: string;
  net_payable: number;
  balance_due: number;
};

export type CostProjectTotals = {
  project: CostProject;
  netMaterialConsumed: number;
  estimatedOpenPoLines: number;
  approvedInvoiceValue: number;
  approvedUnpaidInvoices: number;
  materialToBudgetPercent: number | null;
};

function roundMoney(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function safePositive(n: number) {
  const value = Number(n);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Build *non-additive* summaries for each RLS-visible project.
 * Data arrays must be complete for the displayed scope; callers warn when
 * paginated source datasets have reached their safety cap.
 */
export function summarizeProjectCosts(
  projects: CostProject[],
  purchaseOrders: CostPurchaseOrder[],
  materialUsage: CostMaterial[],
  invoices: CostVendorInvoice[],
): CostProjectTotals[] {
  const costs = new Map<string, { material: number; po: number; invoiced: number; unpaid: number }>();

  function add(projectId: string, key: "material" | "po" | "invoiced" | "unpaid", amount: number) {
    if (!costs.has(projectId)) costs.set(projectId, { material: 0, po: 0, invoiced: 0, unpaid: 0 });
    costs.get(projectId)![key] += amount;
  }

  for (const row of materialUsage) {
    // Negative net values can result from historical reversal corrections. Do
    // not clamp each row, or the project aggregate becomes overstated.
    const amount = Number(row.net_value);
    if (Number.isFinite(amount)) add(row.project_id, "material", amount);
  }
  for (const po of purchaseOrders) {
    if (!ACTIVE_DELIVERY_PO_STATUSES.some(x => x === po.status)) continue;
    add(po.project_id, "po", purchaseOrderLineValues(po.purchase_order_items).estimatedOpenLineValue);
  }
  for (const invoice of invoices) {
    // Unmatched/rejected/draft bills are not an approved project liability.
    if (!["approved", "partially_paid", "paid"].includes(invoice.status)) continue;
    add(invoice.project_id, "invoiced", safePositive(invoice.net_payable));
    if (invoice.status !== "paid") add(invoice.project_id, "unpaid", safePositive(invoice.balance_due));
  }

  return projects.map(project => {
    const s = costs.get(project.id) ?? { material: 0, po: 0, invoiced: 0, unpaid: 0 };
    const budget = Number(project.budget);
    const material = roundMoney(s.material);
    return {
      project,
      netMaterialConsumed: material,
      estimatedOpenPoLines: roundMoney(s.po),
      approvedInvoiceValue: roundMoney(s.invoiced),
      approvedUnpaidInvoices: roundMoney(s.unpaid),
      materialToBudgetPercent: Number.isFinite(budget) && budget > 0
        ? Math.round(material / budget * 1000) / 10 : null,
    };
  });
}
