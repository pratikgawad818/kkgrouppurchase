/**
 * Supplier rate comparison from actual *awarded* purchase orders.
 * Rates are the PO line's BASE unit rate before line discounts/taxes and
 * PO-level freight/other charges. They are not current supplier quotations.
 */
export const AWARDED_PO_STATUSES = [
  "approved", "sent", "partially_received", "partially_accepted",
  "fully_received", "short_closed", "closed",
] as const;

export type PriceLine = {
  material_id: string;
  unit_id: string;
  ordered_quantity: number;
  rate: number;
  discount_amount: number;
  items: { name: string; code: string } | null;
  units_of_measure: { code: string } | null;
};

export type PricePo = {
  id: string;
  po_number: string;
  po_date: string;
  status: string;
  project_id: string;
  projects: { name: string } | null;
  vendor_id: string;
  vendors: { company_name: string } | null;
  purchase_order_items: PriceLine[];
};

export type PriceSample = {
  poId: string;
  poNumber: string;
  date: string;
  projectId: string;
  projectName: string;
  vendorId: string;
  vendorName: string;
  materialId: string;
  materialName: string;
  materialCode: string;
  unitId: string;
  unitCode: string;
  quantity: number;
  rate: number;
  hasDiscount: boolean;
};

export type SupplierRate = {
  vendorId: string;
  vendorName: string;
  latest: PriceSample;
  minRate: number;
  maxRate: number;
  weightedRate: number;
  count: number;
  orderedQty: number;
  anyDiscount: boolean;
};

export type MaterialRate = {
  materialId: string;
  materialName: string;
  materialCode: string;
  unitId: string;
  unitCode: string;
  vendors: SupplierRate[];
  latestDate: string;
  minLatestRate: number;
  maxLatestRate: number;
  sampleCount: number;
};

function money(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }

export function extractAwardedPoRates(pos: PricePo[]): PriceSample[] {
  const samples: PriceSample[] = [];
  for (const po of pos) {
    if (!AWARDED_PO_STATUSES.some(status => status === po.status)) continue;
    for (const line of po.purchase_order_items) {
      const qty = Number(line.ordered_quantity);
      const rate = Number(line.rate);
      if (!line.material_id || !line.unit_id || !Number.isFinite(qty) || qty <= 0 ||
          !Number.isFinite(rate) || rate <= 0) continue;
      samples.push({
        poId: po.id,
        poNumber: po.po_number,
        date: po.po_date,
        projectId: po.project_id,
        projectName: po.projects?.name ?? "Project",
        vendorId: po.vendor_id,
        vendorName: po.vendors?.company_name ?? "Supplier",
        materialId: line.material_id,
        materialName: line.items?.name ?? "Material",
        materialCode: line.items?.code ?? "",
        unitId: line.unit_id,
        unitCode: line.units_of_measure?.code ?? "",
        quantity: qty,
        rate,
        hasDiscount: Number(line.discount_amount) > 0,
      });
    }
  }
  return samples;
}

/**
 * Compare only identical material IDs and unit IDs. For each supplier, "latest"
 * means most recent awarded PO date, NOT a live quotation and NOT best-price
 * confirmation. Weighted rates use ordered quantities; duplicated lines remain
 * distinct recorded purchase observations.
 */
export function summarizeSupplierRates(samples: PriceSample[]): MaterialRate[] {
  const byMaterial = new Map<string, PriceSample[]>();
  for (const x of samples) {
    const key = x.materialId + "|" + x.unitId;
    const rows = byMaterial.get(key) ?? [];
    rows.push(x);
    byMaterial.set(key, rows);
  }

  return [...byMaterial.values()].map(rows => {
    const newestFirst = (a: PriceSample, b: PriceSample) =>
      b.date.localeCompare(a.date) || b.poNumber.localeCompare(a.poNumber) || b.poId.localeCompare(a.poId);
    const sample = rows[0]!;
    const vendorGroups = new Map<string, PriceSample[]>();
    for (const r of rows) {
      const list = vendorGroups.get(r.vendorId) ?? [];
      list.push(r);
      vendorGroups.set(r.vendorId, list);
    }
    const vendors: SupplierRate[] = [...vendorGroups.entries()].map(([vendorId, history]) => {
      history.sort(newestFirst);
      const orderedQty = history.reduce((sum, x) => sum + x.quantity, 0);
      return {
        vendorId,
        vendorName: history[0]!.vendorName,
        latest: history[0]!,
        minRate: Math.min(...history.map(x => x.rate)),
        maxRate: Math.max(...history.map(x => x.rate)),
        weightedRate: money(history.reduce((sum, x) => sum + x.rate * x.quantity, 0) / orderedQty),
        count: history.length,
        orderedQty,
        anyDiscount: history.some(x => x.hasDiscount),
      };
    }).sort((a, b) => a.latest.rate - b.latest.rate || a.vendorName.localeCompare(b.vendorName));

    const rates = vendors.map(x => x.latest.rate);
    return {
      materialId: sample.materialId,
      materialName: sample.materialName,
      materialCode: sample.materialCode,
      unitId: sample.unitId,
      unitCode: sample.unitCode,
      vendors,
      latestDate: vendors.reduce((max, x) => x.latest.date > max ? x.latest.date : max, "0000-00-00"),
      minLatestRate: Math.min(...rates),
      maxLatestRate: Math.max(...rates),
      sampleCount: rows.length,
    };
  }).sort((a, b) => a.materialName.localeCompare(b.materialName) || a.unitCode.localeCompare(b.unitCode));
}
