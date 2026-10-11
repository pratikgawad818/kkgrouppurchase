/**
 * Filter a COMPLETE warehouse movement register in one pass.
 * RLS is enforced by the backend, not here.
 */
export type LedgerFilter = {
  wh: string; project: string; building: string;
  type: string; from: string; to: string;
};
export type LedgerSearchRow = {
  warehouse_id: string;
  project_id: string | null;
  building_id: string | null;
  tx_type: string;
  tx_date: string;
  items: { name: string | null; code: string | null } | null;
  goods_receipt_notes: { grn_number: string } | null;
  stock_transfers: { transfer_number: string } | null;
  stock_adjustments: { adjustment_number: string } | null;
  material_issues: { issue_number: string } | null;
  material_returns: { return_number: string } | null;
};

export function filterStockLedger<T extends LedgerSearchRow>(
  all: readonly T[], filter: LedgerFilter, search: string,
): T[] {
  const term = search.trim().toLocaleLowerCase();
  return all.filter(x => {
    if (filter.wh && x.warehouse_id !== filter.wh) return false;
    if (filter.project && x.project_id !== filter.project) return false;
    if (filter.building && x.building_id !== filter.building) return false;
    if (filter.type && x.tx_type !== filter.type) return false;
    if (filter.from && x.tx_date < filter.from) return false;
    if (filter.to && x.tx_date > filter.to) return false;
    if (!term) return true;
    return [
      x.items?.name, x.items?.code,
      x.goods_receipt_notes?.grn_number,
      x.stock_transfers?.transfer_number,
      x.stock_adjustments?.adjustment_number,
      x.material_issues?.issue_number,
      x.material_returns?.return_number,
    ].some(value => value?.toLocaleLowerCase().includes(term));
  });
}
