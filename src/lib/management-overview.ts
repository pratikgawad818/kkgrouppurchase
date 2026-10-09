/**
 * Management reporting distinguishes stock assets, material consumption,
 * approved supplier bills, and cash outflow. They are NOT additive expenses.
 */
export type MoneyRecord = { amount: number | string };
export type StockValueRow = { warehouse_id: string; quantity_on_hand: number | string; total_value: number | string };
export type ConsumptionValueRow = { project_id: string; net_value: number | string };
export type InvoiceValueRow = { net_payable: number | string; balance_due: number | string };
export type PaymentValueRow = { amount: number | string };

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
  return { stockValue, materialUsageCost, approvedSupplierBills, unpaidSupplierBills, cashPaid, storeAmounts, projectUsage };
}

export const VIEWER_NAV_PATHS = [
  "/management",
  "/inventory/stock",
  "/inventory/material-consumption",
  "/inventory/stock-movements",
  "/reports/project-cost-control",
  "/finance/payables",
  "/finance/payments",
] as const;
export const VIEWER_NAV = new Set<string>(VIEWER_NAV_PATHS);
