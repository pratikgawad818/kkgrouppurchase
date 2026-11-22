/**
 * Only Site Engineers may cancel drafts they recorded themselves, and only
 * Super Admins can cancel anyone's draft. Server RPC separately checks
 * company, current project assignment and unposted status under row lock.
 */
export function canCancelDraftGrn({
  status, receivedBy, viewerId, roles, canCreate,
}: {
  status: string;
  receivedBy: string | null;
  viewerId: string | null | undefined;
  roles: readonly string[];
  canCreate: boolean;
}): boolean {
  if (status !== "draft" || !viewerId) return false;
  if (roles.includes("super_admin")) return true;
  return roles.includes("site_engineer") && canCreate && receivedBy === viewerId;
}
