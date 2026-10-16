type StockRow = {
  quantity_on_hand: number | string;
  total_value: number | string;
  items: {
    minimum_stock: number | string;
    reorder_level: number | string;
    maximum_stock: number | string | null;
  } | null;
};

export function summarizeDashboardStock<T extends StockRow>(rows: readonly T[]) {
  let unconfigured = 0;
  let unvalued = 0;
  const low: T[] = [];
  for (const row of rows) {
    const qty = Number(row.quantity_on_hand),
      value = Number(row.total_value);
    if (!row.items) throw new Error("Material settings could not be verified.");
    const min = Number(row.items.minimum_stock),
      reorder = Number(row.items.reorder_level),
      max = Number(row.items.maximum_stock ?? 0);
    if (![qty, value, min, reorder, max].every(Number.isFinite))
      throw new Error("Stock summary contains invalid numbers.");
    if (qty > 0 && value === 0) unvalued++;
    if (min <= 0 && reorder <= 0 && max <= 0) unconfigured++;
    else if (qty <= Math.max(min, reorder)) low.push(row);
  }
  return { low, unconfigured, unvalued };
}
