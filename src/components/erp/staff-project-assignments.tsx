import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Project access is granted explicitly, not inferred from a job title.
 * The assignments table enforces active-admin, company and project scope
 * through RLS. Each switch saves a single assignment atomically.
 */
export function StaffProjectAssignments({ staffId }: { staffId: string }) {
  const qc = useQueryClient();
  const assignments = useQuery({
    queryKey: ["staff-project-access", staffId],
    queryFn: async () => {
      const [projects, assigned] = await Promise.all([
        supabase.from("projects")
          .select("id,name,code")
          .eq("record_status", "active")
          .order("name"),
        supabase.from("user_project_assignments")
          .select("project_id")
          .eq("user_id", staffId),
      ]);
      if (projects.error) throw projects.error;
      if (assigned.error) throw assigned.error;
      return {
        projects: projects.data ?? [],
        assignedIds: new Set((assigned.data ?? []).map((row) => row.project_id)),
      };
    },
  });

  const update = useMutation({
    mutationFn: async ({ projectId, allow }: { projectId: string; allow: boolean }) => {
      if (!assignments.data?.projects.some((project) => project.id === projectId)) {
        throw new Error("This project is not available for assignment.");
      }
      if (allow) {
        const { data, error } = await supabase
          .from("user_project_assignments")
          .insert({ user_id: staffId, project_id: projectId })
          .select("project_id")
          .single();
        if (error) throw error;
        if (!data) throw new Error("Project assignment was not saved.");
      } else {
        const { data, error } = await supabase
          .from("user_project_assignments")
          .delete()
          .eq("user_id", staffId)
          .eq("project_id", projectId)
          .select("project_id");
        if (error) throw error;
        if (!data?.length) throw new Error("Project assignment could not be removed.");
      }
    },
    onSuccess: async (_result, variables) => {
      await qc.invalidateQueries({ queryKey: ["staff-project-access", staffId] });
      toast.success(variables.allow ? "Project access assigned" : "Project access removed");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <section className="space-y-3 rounded-lg border p-3 sm:col-span-2" aria-label="Staff project access">
      <div>
        <h3 className="text-sm font-semibold">Project access</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Site Engineers can raise Purchase Requests only for assigned projects.
          Select the sites this staff member is responsible for. Changes save immediately.
        </p>
      </div>
      {assignments.isPending ? (
        <p className="text-xs text-muted-foreground">Loading available projects…</p>
      ) : assignments.error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load project assignments: {assignments.error.message}
        </p>
      ) : assignments.data.projects.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No active projects are available to assign.
        </p>
      ) : (
        <div className="max-h-52 space-y-1 overflow-y-auto" role="group" aria-label="Assign projects">
          {assignments.data.projects.map((project) => {
            const checked = assignments.data.assignedIds.has(project.id);
            const busy = update.isPending;
            return (
              <label key={project.id}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                <span className="min-w-0 text-sm">
                  <span className="block font-medium">{project.name}</span>
                  <span className="block text-xs text-muted-foreground">{project.code}</span>
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-primary"
                  aria-label={`Allow access to ${project.name}`}
                  checked={checked}
                  disabled={busy}
                  onChange={(event) => update.mutate({
                    projectId: project.id,
                    allow: event.target.checked,
                  })}
                />
              </label>
            );
          })}
        </div>
      )}
      {update.isPending && <p role="status" className="text-xs text-muted-foreground">Saving project access…</p>}
      {assignments.data && (
        <p className="text-xs text-muted-foreground">
          {assignments.data.assignedIds.size} assigned project(s).
          Staff should refresh their Purchase Request form after any changes.
        </p>
      )}
    </section>
  );
}
