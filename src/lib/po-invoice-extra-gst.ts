import { toPaise } from "./invoice-roundoff.ts";

/** PO-approved GST rules are the source of truth for an invoice's non-material charges. */
export type PoChargeTaxType = "none" | "cgst_sgst" | "igst";
export interface PoChargeTaxRule {
  freight_tax_type: string | null;
  freight_tax_rate_percent: number | string | null;
  other_charges_tax_type: string | null;
  other_charges_tax_rate_percent: number | string | null;
}

export function poInvoiceChargeGst(
  freight: number,
  otherCharges: number,
  po: PoChargeTaxRule | undefined | null,
): { freightGst: number; otherGst: number; total: number } {
  const gst=(base: number, type: string | null | undefined, rate: number | string | null | undefined) =>
    type === "cgst_sgst" || type === "igst"
      ? toPaise(base * Number(rate ?? 0) / 100)
      : 0;
  const freightGst = gst(freight, po?.freight_tax_type, po?.freight_tax_rate_percent);
  const otherGst = gst(otherCharges, po?.other_charges_tax_type, po?.other_charges_tax_rate_percent);
  return { freightGst, otherGst, total: toPaise(freightGst + otherGst) };
}
