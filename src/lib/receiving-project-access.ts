/** A receiving handoff is shared by project, not the PR/PO's original creator. */
export function canReceiveAssignedProject(
  projectId: string,
  assignedProjectIds: readonly string[],
  isScopedEngineer: boolean,
): boolean {
  // Directors and authorized staff with company-wide permissions keep their
  // existing database-authorized scope; only Site Engineers are UI-filtered.
  return !isScopedEngineer || assignedProjectIds.includes(projectId);
}
