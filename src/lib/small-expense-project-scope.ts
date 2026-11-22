/**
 * Expense form project/building choices must be derived from explicit staff
 * assignments, never from a company's unrestricted project catalogue.
 * Caller must load assignments for the current authenticated user; when that
 * lookup fails, callers throw rather than passing an empty or broad fallback.
 */
export function scopeSmallExpenseProjectOptions<
  P extends { id: string },
  B extends { project_id: string },
>(
  projects: readonly P[],
  buildings: readonly B[],
  assignedProjectIds: readonly string[],
  isSiteEngineer: boolean,
): { projects: P[]; buildings: B[] } {
  const assignments = new Set(assignedProjectIds);
  const scopedProjects = isSiteEngineer
    ? projects.filter((project) => assignments.has(project.id))
    : [...projects];
  const permittedProjectIds = new Set(scopedProjects.map((project) => project.id));
  return {
    projects: scopedProjects,
    buildings: buildings.filter((building) => permittedProjectIds.has(building.project_id)),
  };
}
