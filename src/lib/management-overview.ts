/**
 * Management reporting distinguishes stock assets, material consumption,
 * approved supplier bills, and cash outflow. They are NOT additive expenses.
 */
export type MoneyRecord = { amount: number | string };
export type StockValueRow = { warehouse_id: string; quantity_on_hand: number | string; total_value: number | string };
export type ConsumptionValueRow = { project_id: string; net_value: number | string };
export type InvoiceValueRow = { net_payable: number | string; balance_due: number | string };
export type PaymentValueRow = { amount: number | string };
export type HistoricalUsageRow = { id: string; project_id: string; status: string; is_opening: boolean; po_id: string | null; taxable: number | string; material_id: string | null; category: string | null };
export type HistoricalUsage = { approved: number; pending: number; services: number; unclassified: number };
export const emptyHistoricalUsage = (): HistoricalUsage => ({ approved: 0, pending: 0, services: 0, unclassified: 0 });

function amount(value: number | string, source: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${source} amount. Refresh the report or contact Accounts.`);
  return n;
}

export function summarizeManagement(
  stock: readonly StockValueRow[],
  consumed: readonly ConsumptionValueRow[],
  invoices: readonly InvoiceValueRow[],
  payments: readonly PaymentValueRow[],
  historical: readonly HistoricalUsageRow[] = [],
) {
  const stockValue = stock.reduce((sum, x) => sum + amount(x.total_value, "inventory"), 0);
  const materialUsageCost = consumed.reduce((sum, x) => sum + amount(x.net_value, "material consumption"), 0);
  const approvedSupplierBills = invoices.reduce((sum, x) => sum + amount(x.net_payable, "supplier bill"), 0);
  const unpaidSupplierBills = invoices.reduce((sum, x) => sum + amount(x.balance_due, "outstanding payable"), 0);
  const cashPaid = payments.reduce((sum, x) => sum + amount(x.amount, "payment"), 0);
  const storeAmounts = new Map<string, number>();
  for (const row of stock) {
    storeAmounts.set(row.warehouse_id, (storeAmounts.get(row.warehouse_id) ?? 0) + amount(row.total_value, "store stock"));
  }
  const projectUsage = new Map<string, number>();
  for (const row of consumed) {
    projectUsage.set(row.project_id, (projectUsage.get(row.project_id) ?? 0) + amount(row.net_value, "project usage"));
  }
  const historicalUsage = emptyHistoricalUsage();
  const historicalByProject = new Map<string, HistoricalUsage>();
  const seen = new Set<string>();
  for (const row of historical) {
    if (!row.is_opening || row.po_id !== null || !["approved","partially_paid","paid","pending_review","exception"].includes(row.status)) continue;
    if (seen.has(row.id)) throw new Error("Duplicate historical material line. Refresh the report.");
    seen.add(row.id);
    const value = amount(row.taxable, "historical invoice line");
    const project = historicalByProject.get(row.project_id) ?? emptyHistoricalUsage();
    const key = !row.material_id || !row.category?.trim() ? "unclassified"
      : row.category.trim().toLowerCase() === "services" ? "services"
      : ["approved","partially_paid","paid"].includes(row.status) ? "approved" : "pending";
    project[key] += value;
    historicalUsage[key] += value;
    historicalByProject.set(row.project_id, project);
  }
  // Historical opening bills are a separate assumed-use source. Do not alter
  // physical stock, issue/return costs, invoice balances or payment totals.
  const recordedMaterialCost = materialUsageCost + historicalUsage.approved + historicalUsage.pending;
  return { stockValue, materialUsageCost, recordedMaterialCost, historicalUsage, historicalByProject, approvedSupplierBills, unpaidSupplierBills, cashPaid, storeAmounts, projectUsage };
}

export const VIEWER_NAV_PATHS = [
  "/management",
  "/inventory/stock",
  "/inventory/material-consumption",
  "/inventory/stock-movements",
  "/reports/project-cost-control",
  "/finance/payables",
  "/finance/payments",
  "/finance/small-expenses",
] as const;
export const VIEWER_NAV = new Set<string>(VIEWER_NAV_PATHS);
