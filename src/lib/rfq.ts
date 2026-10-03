import type { Database } from "@/integrations/supabase/types";

export type RfqStatus = Database["public"]["Enums"]["rfq_status"];
export type RfqVendorStatus = Database["public"]["Enums"]["rfq_vendor_status"];
export type QuotationStatus = Database["public"]["Enums"]["quotation_status"];

export const RFQ_STATUS: Record<RfqStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-border bg-muted text-muted-foreground" },
  sent: { label: "Sent · Awaiting response", cls: "border-primary/30 bg-primary/10 text-primary" },
  partially_responded: { label: "Partially responded", cls: "border-primary/30 bg-primary/10 text-primary" },
  fully_responded: { label: "Fully responded", cls: "border-primary/50 bg-primary/15 text-primary" },
  ready_for_po: { label: "Ready for Purchase Order", cls: "border-primary bg-primary text-primary-foreground" },
  closed: { label: "Closed", cls: "border-border bg-secondary text-muted-foreground" },
  cancelled: { label: "Cancelled", cls: "border-border bg-secondary text-muted-foreground line-through" },
};
export const RFQ_VENDOR_STATUS: Record<RfqVendorStatus, string> = { pending: "Pending", responded: "Responded", declined: "Declined" };
export const QUOTATION_STATUS: Record<QuotationStatus, string> = { draft: "Draft", submitted: "Submitted", selected: "Selected", rejected: "Not selected" };

export const TAX_RATES = [0, 5, 12, 18, 28];
export const TAX_TYPES = [
  { value: "cgst_sgst", label: "CGST + SGST" },
  { value: "igst", label: "IGST" },
  { value: "none", label: "No tax" },
];

export function lineCalc(qty: number, rate: number, disc: number, taxPct: number, taxType: string) {
  const taxable = Math.max(qty * rate - disc, 0);
  const tax = taxType === "none" ? 0 : (taxable * taxPct) / 100;
  return { taxable: Math.round(taxable * 100) / 100, tax: Math.round(tax * 100) / 100, total: Math.round((taxable + tax) * 100) / 100 };
}

