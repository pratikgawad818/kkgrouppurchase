/**
 * Server-side preconditions for editing a staff account. Keep these in
 * addition to Supabase RLS; UI visibility is never a security boundary.
 */
export function validateStaffUpdate(input: {
  actorId: string;
  actorCompanyId: string | null;
  targetId: string;
  targetCompanyId: string | null;
  actorIsSuperAdmin: boolean;
  existingRoles: readonly string[];
  requestedRole: string | null;
  requestedActive: boolean;
}): { preserveSuperAdmin: boolean; changeRoles: boolean } {
  if (!input.actorCompanyId || input.actorCompanyId !== input.targetCompanyId) {
    throw new Error("You can manage only staff in your own company.");
  }
  const targetIsSuperAdmin = input.existingRoles.includes("super_admin");
  if (input.requestedRole === "super_admin" && !targetIsSuperAdmin) {
    throw new Error("Super Admin access cannot be granted from the staff editor.");
  }
  if (targetIsSuperAdmin) {
    if (!input.actorIsSuperAdmin) {
      throw new Error("Only a Super Admin may update another Super Admin.");
    }
    if (!input.requestedActive) {
      throw new Error("Super Admin accounts cannot be deactivated from this editor.");
    }
    if (input.requestedRole && input.requestedRole !== "super_admin") {
      throw new Error("Super Admin roles cannot be replaced from this editor.");
    }
    return { preserveSuperAdmin: true, changeRoles: false };
  }
  if (input.actorId === input.targetId &&
      (input.existingRoles.length !== 1 || input.requestedRole !== input.existingRoles[0])) {
    throw new Error("You cannot change your own role.");
  }
  if (input.actorId === input.targetId && !input.requestedActive) {
    throw new Error("You cannot deactivate your own account.");
  }
  const changeRoles = input.existingRoles.length !== (input.requestedRole ? 1 : 0) ||
    input.existingRoles[0] !== input.requestedRole;
  return { preserveSuperAdmin: false, changeRoles };
}
