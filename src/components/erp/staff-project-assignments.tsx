import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

/**
 * Project access is granted explicitly, not inferred from a job title.
 * Existing Storage/DB RLS enforces company and project scope.
 * Each checkbox saves one assignment immediately, without a modal-wide save.
 */
export function StaffProjectAssignments({ staffId }: { staffId: string }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
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

  const projects = assignments.data?.projects ?? [];
  const assignedCount = projects.filter((project) =>
    assignments.data?.assignedIds.has(project.id),
  ).length;
  const query = search.trim().toLowerCase();
  const visible = projects.filter((project) =>
    `${project.name} ${project.code ?? ""}`.toLowerCase().includes(query),
  );

  return (
    <section className="overflow-hidden rounded-xl border bg-card" aria-label="Staff project access">
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Project access</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Site Engineers can create purchase requests, register supplier challans,
              and record goods receipts for assigned projects—even for a colleague's PO.
              Select the sites this staff member may access.
            </p>
          </div>
          {!assignments.isPending && !assignments.error && (
            <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-semibold tabular-nums text-foreground">
              {assignedCount} of {projects.length} assigned
            </span>
          )}
        </div>
        {projects.length > 5 && (
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="staff-project-search" className="sr-only">Search projects</label>
            <Input id="staff-project-search" type="search" value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by project name or code…" className="pl-9" />
          </div>
        )}
      </div>

      {assignments.isPending ? (
        <p role="status" className="border-t px-4 py-4 text-sm text-muted-foreground">
          Loading available projects…
        </p>
      ) : assignments.error ? (
        <p role="alert" className="border-t px-4 py-4 text-sm text-destructive">
          Could not load project assignments: {assignments.error.message}
        </p>
      ) : projects.length === 0 ? (
        <p className="border-t px-4 py-4 text-sm text-muted-foreground">
          No active projects are available to assign.
        </p>
      ) : (
        <div className="divide-y border-t" role="group" aria-label="Assign projects">
          {visible.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              No matching projects. Try another name or code.
            </p>
          ) : visible.map((project) => {
            const checked = assignments.data?.assignedIds.has(project.id) ?? false;
            return (
              <label key={project.id}
                className="flex min-h-14 cursor-pointer items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/30">
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium">{project.name}</span>
                  <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                    {project.code || "Project"}
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait"
                  aria-label={`Allow access to ${project.name}`}
                  checked={checked}
                  disabled={update.isPending}
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
      <div className="border-t bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
        {update.isPending
          ? "Saving project access…"
          : "Changes save automatically. Staff may need to refresh the Purchase Request form."}
      </div>
    </section>
  );
}
