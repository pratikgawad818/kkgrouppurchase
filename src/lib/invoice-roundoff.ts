/**
 * Invoice round-off is opt-in and applies only to the gross payable, not
 * material rates, taxable values, GST, TDS or historical payments.
 * PostgreSQL NUMERIC is authoritative; this function is a UI preview.
 */
export type InvoiceRoundOffMode = "none" | "nearest_rupee";

export function toPaise(value: number): number {
  if (!Number.isFinite(value)) return NaN;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function optionalInvoiceRoundOff(gross: number, mode: InvoiceRoundOffMode): number {
  if (mode === "none") return 0;
  if (mode !== "nearest_rupee" || !Number.isFinite(gross) || gross < 0) {
    throw new Error("Invalid invoice round-off request");
  }
  return toPaise(Math.round(toPaise(gross)) - toPaise(gross));
}
