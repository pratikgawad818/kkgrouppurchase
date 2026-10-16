export type TaskGroup = "purchasing" | "payments";
export type WorkspaceTask = {
  id: string;
  kind: "request" | "rfq" | "order" | "invoice" | "payment";
  group: TaskGroup;
  number: string;
  description: string;
  project: string;
  due: string | null;
  action: string;
  href: string;
};

/** ISO calendar dates are compared without the viewer's browser timezone. */
export function taskDue(due: string | null, today: string) {
  if (!due) return { label: "No due date", tone: "neutral" as const };
  if (due < today) return { label: "Overdue", tone: "overdue" as const };
  if (due === today) return { label: "Today", tone: "today" as const };
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (due === tomorrow.toISOString().slice(0, 10))
    return { label: "Tomorrow", tone: "soon" as const };
  return {
    label: new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${due}T12:00:00Z`)),
    tone: "neutral" as const,
  };
}

export function orderedTasks(tasks: WorkspaceTask[], group: TaskGroup | "all") {
  return tasks
    .filter((task) => group === "all" || task.group === group)
    .sort(
      (a, b) =>
        (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.number.localeCompare(b.number),
    );
}
