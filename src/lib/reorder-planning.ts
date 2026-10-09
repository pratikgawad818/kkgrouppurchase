/**
 * Warehouse-level reorder intelligence. Read-only calculation, NEVER creates
 * requisitions, purchases or stock transactions.
 *
 * Do not assume a material belongs in every warehouse. Only plan existing
 * stock locations or incoming POs with an explicitly assigned destination.
 * Orders without a warehouse are separately flagged, never allocated.
 */
import { ACTIVE_DELIVERY_PO_STATUSES } from "./procurement-followup.ts";

export type PlanningMaterial = {
  id: string;
  code: string;
  name: string;
  status: string;
  minimum_stock: number;
  reorder_level: number;
  maximum_stock: number | null;
  units_of_measure: { code: string } | null;
};

export type PlanningStore = {
  id: string;
  code: string;
  name: string;
  status: string;
  project_id: string | null;
  projects?: { name: string } | null;
};

export type PlanningStock = {
  warehouse_id: string;
  material_id: string;
  quantity_on_hand: number;
};

export type PlanningPoItem = {
  material_id: string;
  ordered_quantity: number;
  accepted_quantity: number;
  short_closed_quantity: number;
};

export type PlanningPo = {
  id: string;
  po_number: string;
  status: string;
  delivery_warehouse_id: string | null;
  expected_delivery_date: string | null;
  purchase_order_items: PlanningPoItem[];
};

export type IncomingOrder = {
  id: string;
  number: string;
  qty: number;
  expectedDate: string | null;
};

export type ReorderState = "out_of_stock" | "order_review" | "await_inbound";

export type ReorderLine = {
  key: string;
  material: PlanningMaterial;
  store: PlanningStore;
  onHand: number;
  reorderPoint: number;
  target: number | null;
  incoming: number;
  projectedIfDelivered: number;
  gapToReorderPoint: number;
  suggestedTopUp: number | null;
  state: ReorderState;
  hasOverdueInbound: boolean;
  hasUndatedInbound: boolean;
  incomingOrders: IncomingOrder[];
  unassignedIncoming: number;
};

export type UnallocatedIncoming = {
  material: PlanningMaterial;
  qty: number;
  purchaseOrders: number;
};

export type PlanningResult = {
  lines: ReorderLine[];
  unallocated: UnallocatedIncoming[];
  notAssignedToStore: PlanningMaterial[];
  unconfiguredStockLines: number;
};

const keyFor = (warehouseId: string, materialId: string) => warehouseId + "|" + materialId;

function nonNegative(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function rounded(n: number) { return Math.round((n + Number.EPSILON) * 1000) / 1000; }

export function openPoQuantity(item: PlanningPoItem): number {
  const ordered = nonNegative(item.ordered_quantity);
  const accepted = Math.min(ordered, nonNegative(item.accepted_quantity));
  const shortClosed = Math.min(Math.max(0, ordered - accepted), nonNegative(item.short_closed_quantity));
  return rounded(Math.max(0, ordered - accepted - shortClosed));
}

/** Projects and warehouses returned here are already scoped by database RLS.
 * A null purchase order destination is NOT interchangeable with any site store.
 */
export function planReorders(
  materials: PlanningMaterial[],
  stores: PlanningStore[],
  stock: PlanningStock[],
  purchaseOrders: PlanningPo[] | null,
  todayIso: string,
): PlanningResult {
  const materialMap = new Map(materials.filter(m => m.status === "active").map(m => [m.id, m]));
  const storeMap = new Map(stores.filter(w => w.status === "active").map(w => [w.id, w]));
  const knownLocations = new Map<string, number>();
  const recordedMaterials = new Set<string>();
  let unconfiguredStockLines = 0;

  for (const row of stock) {
    if (!materialMap.has(row.material_id) || !storeMap.has(row.warehouse_id)) continue;
    const key = keyFor(row.warehouse_id, row.material_id);
    knownLocations.set(key, Number(row.quantity_on_hand) || 0);
    recordedMaterials.add(row.material_id);
  }

  const inboundByLocation = new Map<string, IncomingOrder[]>();
  const unallocatedByMaterial = new Map<string, IncomingOrder[]>();

  for (const po of purchaseOrders ?? []) {
    if (!ACTIVE_DELIVERY_PO_STATUSES.some(status => status === po.status)) continue;
    for (const item of po.purchase_order_items) {
      if (!materialMap.has(item.material_id)) continue;
      const qty = openPoQuantity(item);
      if (qty <= 0) continue;
      const order: IncomingOrder = {
        id: po.id,
        number: po.po_number,
        qty,
        expectedDate: po.expected_delivery_date,
      };
      const dest = po.delivery_warehouse_id;
      if (dest && storeMap.has(dest)) {
        const key = keyFor(dest, item.material_id);
        const existing = inboundByLocation.get(key) ?? [];
        existing.push(order);
        inboundByLocation.set(key, existing);
        // Explicit PO destination establishes the intended warehouse even
        // when the first GRN has not created a warehouse_stock row yet.
        if (!knownLocations.has(key)) knownLocations.set(key, 0);
        recordedMaterials.add(item.material_id);
      } else {
        // Missing or inaccessible warehouse cannot be assumed as inbound
        // for any monitored store; surface it for allocation review.
        const existing = unallocatedByMaterial.get(item.material_id) ?? [];
        existing.push(order);
        unallocatedByMaterial.set(item.material_id, existing);
      }
    }
  }

  const unallocated: UnallocatedIncoming[] = [...unallocatedByMaterial.entries()].map(([materialId, rows]) => ({
    material: materialMap.get(materialId)!,
    qty: rounded(rows.reduce((sum, r) => sum + r.qty, 0)),
    purchaseOrders: new Set(rows.map(x => x.id)).size,
  })).sort((a, b) => a.material.name.localeCompare(b.material.name));

  const lines: ReorderLine[] = [];
  for (const [key, onHand] of knownLocations) {
    const divider = key.indexOf("|");
    const warehouseId = key.slice(0, divider);
    const materialId = key.slice(divider + 1);
    const material = materialMap.get(materialId)!;
    const store = storeMap.get(warehouseId)!;

    const min = nonNegative(material.minimum_stock);
    const reorder = nonNegative(material.reorder_level);
    const reorderPoint = Math.max(min, reorder);
    const max = nonNegative(material.maximum_stock);
    if (reorderPoint === 0 && max === 0) {
      unconfiguredStockLines++;
      continue;
    }

    // For an unconfigured reorder threshold of zero, only alert when empty.
    if (onHand > reorderPoint) continue;

    const incomingOrders = inboundByLocation.get(key) ?? [];
    const incoming = rounded(incomingOrders.reduce((sum, x) => sum + x.qty, 0));
    const projectedIfDelivered = rounded(Math.max(0, onHand) + incoming);
    const coverageSufficient = projectedIfDelivered > reorderPoint;
    const suggestedTopUp = purchaseOrders === null ? null : coverageSufficient ? 0 : max > reorderPoint
      ? rounded(Math.max(0, max - projectedIfDelivered)) : null;
    const unknownLocationInbound = unallocatedByMaterial.get(materialId) ?? [];

    lines.push({
      key,
      material,
      store,
      onHand,
      reorderPoint,
      target: max > reorderPoint ? max : null,
      incoming,
      projectedIfDelivered,
      gapToReorderPoint: rounded(Math.max(0, reorderPoint - projectedIfDelivered)),
      suggestedTopUp,
      state: onHand <= 0 ? "out_of_stock" : coverageSufficient ? "await_inbound" : "order_review",
      hasOverdueInbound: incomingOrders.some(x => !!x.expectedDate && x.expectedDate < todayIso),
      hasUndatedInbound: incomingOrders.some(x => !x.expectedDate),
      incomingOrders,
      unassignedIncoming: rounded(unknownLocationInbound.reduce((sum, x) => sum + x.qty, 0)),
    });
  }

  const order = { out_of_stock: 0, order_review: 1, await_inbound: 2 } as const;
  lines.sort((a, b) => order[a.state] - order[b.state] ||
    a.store.name.localeCompare(b.store.name) || a.material.name.localeCompare(b.material.name));

  return {
    lines,
    unallocated,
    // No store is assumed for materials without any visible stock or
    // destination-specific incoming PO. Their eventual location is unknown.
    notAssignedToStore: [...materialMap.values()]
      .filter(m => Math.max(nonNegative(m.minimum_stock), nonNegative(m.reorder_level), nonNegative(m.maximum_stock)) > 0)
      .filter(m => !recordedMaterials.has(m.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
    unconfiguredStockLines,
  };
}
