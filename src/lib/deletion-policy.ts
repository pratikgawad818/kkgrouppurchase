export type DeletionKind = "material" | "purchase_request" | "rfq" | "user";

export function validatePermanentDeletion(input: {
  isSuperAdmin: boolean; active: boolean; actorCompanyId: string | null;
  targetCompanyId: string | null; kind: DeletionKind; actorId: string;
  targetId: string; targetIsSuperAdmin?: boolean; status?: string;
}) {
  if (!input.isSuperAdmin || !input.active) throw new Error("Only an active Super Admin can permanently delete records.");
  if (!input.actorCompanyId || input.actorCompanyId !== input.targetCompanyId) throw new Error("You can delete records only in your own company.");
  if (input.kind === "user" && (input.actorId === input.targetId || input.targetIsSuperAdmin)) throw new Error("Your own account and Super Admin accounts cannot be deleted.");
  if ((input.kind === "purchase_request" || input.kind === "rfq") && input.status !== "draft") throw new Error("Only unused drafts can be permanently deleted. Submitted documents retain their history.");
}