/** Match the workflow rule: Super Admin orders always require an independent Director. */
export function directorCanFinalizeOwnPurchasing(roles: readonly string[]): boolean {
  return roles.includes("director") && !roles.includes("super_admin");
}
