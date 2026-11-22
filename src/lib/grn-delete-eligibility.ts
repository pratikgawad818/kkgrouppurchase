/** Never offer permanent deletion for a GRN that might have reached stock. */
export function canPermanentlyDeleteUnusedGrn(
  role: readonly string[],
  active: boolean,
  status: string,
  postedAt: string | null,
): boolean {
  return active && role.includes("super_admin") &&
    (status === "draft" || status === "cancelled") && postedAt === null;
}
