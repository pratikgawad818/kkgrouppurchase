export const DELETION_KINDS = [
  "material",
  "vendor",
  "project",
  "building",
  "floor",
  "unit",
  "warehouse",
  "purchase_request",
  "rfq",
  "purchase_order",
  "vendor_invoice",
  "goods_receipt",
  "user",
] as const;
export type DeletionKind = (typeof DELETION_KINDS)[number];

export function validatePermanentDeletion(input: {
  isSuperAdmin: boolean;
  active: boolean;
  actorCompanyId: string | null;
  targetCompanyId: string | null;
  kind: DeletionKind;
  actorId: string;
  targetId: string;
  targetIsSuperAdmin?: boolean;
  status?: string;
}) {
  if (!input.isSuperAdmin || !input.active)
    throw new Error("Only an active Super Admin can permanently delete records.");
  if (!input.actorCompanyId || input.actorCompanyId !== input.targetCompanyId)
    throw new Error("You can delete records only in your own company.");
  if (input.kind === "user" && (input.actorId === input.targetId || input.targetIsSuperAdmin))
    throw new Error("Your own account and Super Admin accounts cannot be deleted.");
  if (
    ["purchase_request", "rfq", "purchase_order", "vendor_invoice", "goods_receipt"].includes(
      input.kind,
    ) &&
    input.status !== "draft"
  )
    throw new Error(
      "Only unused drafts can be permanently deleted. Submitted documents retain their history.",
    );
  if (input.kind === "unit" && input.status !== "available")
    throw new Error("Only an unused available property unit can be permanently deleted.");
}
