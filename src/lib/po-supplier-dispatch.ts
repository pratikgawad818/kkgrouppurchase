/**
 * "PO sent to supplier" is an optional procurement record, not a precondition
 * of a vendor challan or goods receipt. Hide this manual acknowledgment once
 * the supplier has already recorded a delivery, even if PO status is still
 * approved because receipts have not yet been posted to stock.
 */
export function canConfirmPoSentToSupplier(
  poStatus: string,
  canManagePo: boolean,
  challans: readonly { status: string }[],
  receipts: readonly { status: string }[],
): boolean {
  return poStatus === "approved" && canManagePo &&
    !challans.some((item) => item.status === "registered") &&
    !receipts.some((item) => item.status !== "cancelled");
}
