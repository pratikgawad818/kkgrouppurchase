/**
 * Read-only summary for the printable Purchase Order.
 *
 * Individual PO item amounts exclude GST; charge-level GST lives on the PO
 * header. Never add it a second time when displaying the CGST/SGST/IGST split.
 * Database grand_total remains the source of truth for contractual amounts.
 */
export type PoTaxItem = { tax_amount: number | string; tax_type: string };
export type PoCommercialTotals = {
  subtotal: number | string;
  discount_total: number | string;
  freight: number | string;
  other_charges: number | string;
  tax_total: number | string;
  grand_total: number | string;
  freight_tax_type?: string | null;
  freight_tax_amount?: number | string | null;
  other_charges_tax_type?: string | null;
  other_charges_tax_amount?: number | string | null;
};

const cents = (amount: number | string | null | undefined): number =>
  Math.round(Number(amount ?? 0) * 100);

/** Splitting in integer paise avoids CGST/SGST discrepancies from float halves. */
export function poCommercialSummary(
  po: PoCommercialTotals,
  items: readonly PoTaxItem[],
) {
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let itemGst = 0;

  const allocate = (amount: number | string | null | undefined, type: string) => {
    const taxCents = cents(amount);
    if (type === "igst") {
      igst += taxCents;
    } else if (type === "cgst_sgst") {
      const central = Math.ceil(taxCents / 2);
      cgst += central;
      sgst += taxCents - central;
    }
    return taxCents;
  };

  for (const item of items) {
    itemGst += allocate(item.tax_amount, item.tax_type);
  }
  const freightGst = allocate(po.freight_tax_amount, po.freight_tax_type ?? "none");
  const otherGst = allocate(po.other_charges_tax_amount, po.other_charges_tax_type ?? "none");

  const beforeGst = cents(po.subtotal) - cents(po.discount_total) +
    cents(po.freight) + cents(po.other_charges);
  const summedGst = cgst + sgst + igst;
  const recordedGst = cents(po.tax_total);
  const recordedGrand = cents(po.grand_total);
  const expectedGrand = beforeGst + summedGst;

  return {
    goodsNet: (cents(po.subtotal) - cents(po.discount_total)) / 100,
    beforeGst: beforeGst / 100,
    cgst: cgst / 100,
    sgst: sgst / 100,
    igst: igst / 100,
    itemGst: itemGst / 100,
    freightGst: freightGst / 100,
    otherGst: otherGst / 100,
    recordedGst: recordedGst / 100,
    grandTotal: recordedGrand / 100,
    // Warn rather than masking any inconsistent database amounts as round-off.
    difference: (recordedGrand - expectedGrand) / 100,
    gstDifference: (recordedGst - summedGst) / 100,
  };
}
