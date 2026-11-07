/**
 * Read-only supplier-bill allocations for the project consumption workspace.
 *
 * A vendor invoice establishes a documented purchase/cost, not a stock issue.
 * Never post these rows to warehouse_stock, material_issues or the project cost
 * ledger. Verified consumption remains sourced exclusively from issue/return
 * transactions (and separately labelled historical entries).
 */
export type InvoiceMaterialAllocation = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  vendorName: string;
  status: string;
  source: "opening" | "matched";
  projectId: string;
  projectName: string;
  buildingId: string | null;
  buildingName: string | null;
  materialId: string | null;
  materialName: string;
  materialCode: string | null;
  unit: string;
  quantity: number;
  taxableValue: number;
  remarks: string | null;
};

export type InvoiceMaterialSummary = {
  key: string;
  projectId: string;
  projectName: string;
  buildingId: string | null;
  buildingName: string | null;
  materialId: string | null;
  materialName: string;
  materialCode: string | null;
  unit: string;
  acceptedInvoiceQuantity: number;
  pendingInvoiceQuantity: number;
  acceptedInvoiceValue: number;
  pendingInvoiceValue: number;
  invoiceCount: number;
  lineCount: number;
};

/** Rejected/cancelled bills do not contribute quantities to this view. */
export const isReportableInvoiceStatus = (status: string): boolean =>
  status !== "rejected" && status !== "cancelled";

/** Approved or paid bills are reported separately from bills still in review. */
export const isReviewedInvoiceStatus = (status: string): boolean =>
  status === "approved" || status === "partially_paid" || status === "paid";

/**
 * Units are part of the grouping key: kilograms, cubic metres and pieces
 * must not be summed together, even if their material name happens to match.
 */
export function summarizeInvoiceMaterialAllocations(
  lines: InvoiceMaterialAllocation[],
): InvoiceMaterialSummary[] {
  const grouped = new Map<string, InvoiceMaterialSummary & { invoiceIds: Set<string> }>();
  for (const line of lines) {
    if (!isReportableInvoiceStatus(line.status)) continue;
    if (!Number.isFinite(line.quantity) || !Number.isFinite(line.taxableValue)) {
      throw new Error("Supplier invoice material totals contain an invalid quantity or amount.");
    }
    const identity = line.materialId ?? `name:${line.materialName.trim().toLowerCase()}`;
    const key = JSON.stringify([line.projectId, line.buildingId, identity, line.unit.trim().toUpperCase()]);
    let group = grouped.get(key);
    if (!group) {
      group = {
        key,
        projectId: line.projectId,
        projectName: line.projectName,
        buildingId: line.buildingId,
        buildingName: line.buildingName,
        materialId: line.materialId,
        materialName: line.materialName,
        materialCode: line.materialCode,
        unit: line.unit,
        acceptedInvoiceQuantity: 0,
        pendingInvoiceQuantity: 0,
        acceptedInvoiceValue: 0,
        pendingInvoiceValue: 0,
        invoiceCount: 0,
        lineCount: 0,
        invoiceIds: new Set<string>(),
      };
      grouped.set(key, group);
    }
    if (isReviewedInvoiceStatus(line.status)) {
      group.acceptedInvoiceQuantity += line.quantity;
      group.acceptedInvoiceValue += line.taxableValue;
    } else {
      group.pendingInvoiceQuantity += line.quantity;
      group.pendingInvoiceValue += line.taxableValue;
    }
    group.invoiceIds.add(line.invoiceId);
    group.lineCount++;
  }
  return [...grouped.values()]
    .map(({ invoiceIds, ...group }) => ({
      ...group,
      invoiceCount: invoiceIds.size,
      acceptedInvoiceValue: Math.round(group.acceptedInvoiceValue * 100) / 100,
      pendingInvoiceValue: Math.round(group.pendingInvoiceValue * 100) / 100,
    }))
    .sort((a, b) =>
      a.projectName.localeCompare(b.projectName) ||
      a.materialName.localeCompare(b.materialName) ||
      (a.buildingName ?? "").localeCompare(b.buildingName ?? "") ||
      a.unit.localeCompare(b.unit),
    );
}
