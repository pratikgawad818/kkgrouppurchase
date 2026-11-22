import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";

/** Match immutable project IDs, never project names or original request owners. */
export function canReceiveAssignedProject(
  projectId: string,
  assignedProjectIds: readonly string[],
  isScopedEngineer: boolean,
): boolean {
  return !isScopedEngineer || assignedProjectIds.includes(projectId);
}

/**
 * Site Engineers operate by explicit project assignment, not by PR/PO creator.
 * This hook scopes the two field-receiving selectors in the UI. Database
 * RLS and the register_vendor_delivery_challan/create_goods_receipt RPCs
 * independently enforce the same company/project rule at write time.
 *
 * Other authorized roles retain their existing permissions and visibility.
 */
export function useSiteEngineerReceivingScope() {
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
    isScopedEngineer,
    assignedProjectIds,
    isLoading: isScopedEngineer && assigned.isLoading,
    error: isScopedEngineer ? assigned.error : null,
    canAccess: (projectId: string) =>
      canReceiveAssignedProject(projectId, assignedProjectIds, isScopedEngineer),
  };
}
