export const FORCE_DELETION_KINDS = ["material","purchase_request","rfq","vendor_quotation","purchase_order","delivery_challan","goods_receipt","material_issue","material_return","vendor_invoice","vendor_payment","small_expense"] as const;
export type ForceDeletionKind = (typeof FORCE_DELETION_KINDS)[number];
export type DeletionKind = ForceDeletionKind | "user";

export function validatePermanentDeletion(input: {
  isSuperAdmin: boolean; active: boolean; actorCompanyId: string | null;
  targetCompanyId: string | null; kind: DeletionKind; actorId: string;
  targetId: string; targetIsSuperAdmin?: boolean; status?: string;
}) {
  if (!input.isSuperAdmin || !input.active) throw new Error("Only an active Super Admin can permanently delete records.");
  if (!input.actorCompanyId || input.actorCompanyId !== input.targetCompanyId) throw new Error("You can delete records only in your own company.");
  if (input.kind === "user" && (input.actorId === input.targetId || input.targetIsSuperAdmin)) throw new Error("Your own account and Super Admin accounts cannot be deleted.");
}
