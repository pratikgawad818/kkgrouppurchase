/** Complete and validated physical stock rollup, never a truncated preview. */
export type StockRollupLine = {
  warehouse_id: string;
  material_id: string;
  quantity_on_hand: number;
  total_value: number;
  items: { name: string; code: string; reorder_level: number | null } | null;
};

export type StockLevel = "out" | "low" | "normal";

export function stockLevel(line: StockRollupLine): StockLevel {
  const quantity = Number(line.quantity_on_hand);
  const reorder = Number(line.items?.reorder_level ?? 0);
  if (quantity <= 0) return "out";
  return quantity <= reorder ? "low" : "normal";
}

export function filteredStockSummary<T extends StockRollupLine>(
  all: readonly T[], warehouseId: string, search: string,
): { rows: T[]; totalValue: number; low: number; out: number } {
  const term = search.trim().toLocaleLowerCase();
  const rows: T[] = [];
  let valuePaise = 0, low = 0, out = 0;
  for (const item of all) {
    // Fail closed: never show a monetary summary from invalid/partial figures.
    const value = Number(item.total_value);
    const quantity = Number(item.quantity_on_hand);
    const reorder = Number(item.items?.reorder_level ?? 0);
    if (![value,quantity,reorder].every(Number.isFinite) ||
      !item.warehouse_id || !item.material_id) {
      throw new Error("Stock has invalid values. Refresh or contact Inventory.");
    }
    if (warehouseId && item.warehouse_id !== warehouseId) continue;
    if (term && ![item.items?.name,item.items?.code].some(text =>
      text?.toLocaleLowerCase().includes(term))) continue;
    rows.push(item);
    valuePaise += Math.round(value * 100);
    const level = stockLevel(item);
    if (level === "out") out++;
    if (level === "low") low++;
  }
  return { rows, totalValue: valuePaise / 100, low, out };
}
