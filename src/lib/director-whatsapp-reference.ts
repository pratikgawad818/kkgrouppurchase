/** Non-secret route locator: it never grants the authority to approve. */
export type DirectorDocumentKind = "purchase_order" | "vendor_payment";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATTERN = new RegExp("^(po|pay)_(" + UUID + ")$", "i");

export function approvalReference(kind: DirectorDocumentKind, id: string) {
  if (!new RegExp("^"+UUID+"$","i").test(id)) throw new Error("Invalid document UUID");
  return (kind === "purchase_order" ? "po_" : "pay_") + id.toLowerCase();
}
export function parseApprovalReference(value: unknown): { kind: DirectorDocumentKind; id: string } | null {
  if (typeof value !== "string") return null;
  const hit = PATTERN.exec(value);
  if (!hit) return null;
  return { kind: hit[1]!.toLowerCase() === "po" ? "purchase_order" : "vendor_payment",
    id: hit[2]!.toLowerCase() };
}
