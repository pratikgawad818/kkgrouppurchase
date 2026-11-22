import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { canReceiveAssignedProject } from "@/lib/receiving-project-access";

/**
 * Scope field-facing PR / PO registers and receiving to explicitly assigned
 * projects (not purchase requester or PO creator). SQL RLS and write RPCs
 * independently enforce the same company/project membership rule.
 * Management roles with projects.view_all keep their existing access.
 */
export function useSiteEngineerProjectScope() {
  const me = useMe();
  const userId = me.data?.profile.id;
  const isScopedEngineer =
    !!me.data?.roles.includes("site_engineer") &&
    !me.data.permissions.has("projects.view_all");

  const assigned = useQuery({
    queryKey: ["site-engineer-receiving-projects", userId],
    enabled: isScopedEngineer && !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<string[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("user_project_assignments")
        .select("project_id")
        .eq("user_id", userId);
      if (error) throw error;
      return [...new Set((data ?? []).map((assignment) => assignment.project_id))];
    },
  });

  const assignedProjectIds = isScopedEngineer ? (assigned.data ?? []) : [];
  return {
    userId,
    isScopedEngineer,
    assignedProjectIds,
    isLoading: isScopedEngineer && assigned.isLoading,
    error: isScopedEngineer ? assigned.error : null,
    canAccess: (projectId: string) =>
      canReceiveAssignedProject(projectId, assignedProjectIds, isScopedEngineer),
  };
}

/** Backwards-compatible name for the two field-receiving screens. */
export const useSiteEngineerReceivingScope = useSiteEngineerProjectScope;
