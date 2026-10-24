/**
 * Spreadsheet user input is never a direct inventory or finance mutation.
 * Historic entries are separate from the stock ledger and are identified by
 * a stable user-supplied Reference (e.g. LEGACY-0001).
 */
export const HISTORICAL_TAB = "ERP - Historical Consumption";
export const HISTORICAL_HEADERS = [
  "Reference", "Date (YYYY-MM-DD)", "Project Code", "Building Code",
  "Material Code", "Quantity", "Unit Cost INR", "Purpose",
  "ERP Record ID (do not edit)", "Sync Status", "Sync Error",
] as const;

export const EXPORT_TABS = [
  { name: "ERP - Projects", table: "projects", columns: "id,code,name,status", companyColumn: "company_id" },
  { name: "ERP - Materials", table: "items", columns: "id,code,name,status,unit_id", companyColumn: "company_id" },
  { name: "ERP - Vendors", table: "vendors", columns: "id,code,company_name,status", companyColumn: "company_id" },
  { name: "ERP - Warehouses", table: "warehouses", columns: "id,code,name,status,project_id", companyColumn: "company_id" },
  { name: "ERP - Buildings", table: "buildings", columns: "id,code,name,project_id", companyColumn: "company_id" },
  { name: "ERP - Purchase Requests", table: "purchase_requests", columns: "id,pr_number,status,project_id,created_at", companyColumn: "company_id" },
  { name: "ERP - Purchase Orders", table: "purchase_orders", columns: "id,po_number,status,project_id,created_at", companyColumn: "company_id" },
  { name: "ERP - Goods Received", table: "goods_receipt_notes", columns: "id,grn_number,status,created_at", companyColumn: "company_id" },
  { name: "ERP - Material Issues", table: "material_issues", columns: "id,issue_number,issue_date,project_id,building_id,warehouse_id", companyColumn: "company_id" },
  { name: "ERP - Vendor Invoices", table: "vendor_invoices", columns: "id,invoice_number,status,created_at", companyColumn: "company_id" },
  { name: "ERP - Vendor Payments", table: "vendor_payments", columns: "id,status,created_at", companyColumn: "company_id" },
] as const;

export function parseSpreadsheetId(value: string): string {
  const input = value.trim();
  const match = input.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{25,})(?:\/[^?#]*)?(?:[?#].*)?$/);
  if (!match) throw new Error("Paste a full Google Sheets URL from docs.google.com/spreadsheets/d/…");
  return match[1];
}

export type HistoricalInput = {
  reference: string; date: string; projectCode: string; buildingCode: string;
  materialCode: string; quantity: number; unitCost: number; purpose: string;
};
export function parseHistoricalRow(row: readonly unknown[]): HistoricalInput {
  const cell = (i: number) => String(row[i] ?? "").trim();
  const reference = cell(0);
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(reference))
    throw new Error("Reference must be 2–64 letters, numbers, hyphens or underscores.");
  const date = cell(1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date + "T00:00:00Z")) ||
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)
    throw new Error("Date must be a real date in YYYY-MM-DD format.");
  const projectCode = cell(2), buildingCode = cell(3), materialCode = cell(4);
  if (!projectCode || !materialCode) throw new Error("Project Code and Material Code are required.");
  const quantity = Number(cell(5));
  const unitCost = cell(6) === "" ? 0 : Number(cell(6));
  if (!cell(5) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 ||
    Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.00001)
    throw new Error("Quantity must be positive with at most 3 decimal places.");
  if (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 1_000_000_000 ||
    Math.abs(unitCost * 100 - Math.round(unitCost * 100)) > 0.00001)
    throw new Error("Unit cost must be a nonnegative amount with at most 2 decimal places.");
  const purpose = cell(7).slice(0, 500);
  return { reference, date, projectCode, buildingCode, materialCode, quantity, unitCost, purpose };
}
export function canonicalHistorical(row: HistoricalInput): string {
  return JSON.stringify([
    row.reference, row.date, row.projectCode, row.buildingCode,
    row.materialCode, row.quantity, row.unitCost, row.purpose,
  ]);
}
export function decideHistoricalConflict(previous: string | null, erp: string | null, sheet: string) {
  if (erp === null) return "import" as const;
  if (erp === sheet) return "unchanged" as const;
  if (previous === null) return "conflict" as const;
  if (erp !== previous && sheet !== previous) return "conflict" as const;
  return erp !== previous ? "export" as const : "import" as const;
}
