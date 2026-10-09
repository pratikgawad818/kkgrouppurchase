/** Reusable first-run readiness checks for an ERP without seeded demo records. */
export type SetupCounts = {
  projects: number;
  vendors: number;
  categories: number;
  materials: number;
  warehouses: number;
};

export type SetupStep = {
  key: keyof SetupCounts;
  label: string;
  detail: string;
  to: "/projects" | "/vendors" | "/materials" | "/warehouses";
  permission: string;
  completed: boolean;
};

export function setupSteps(counts: SetupCounts): SetupStep[] {
  const steps: Omit<SetupStep, "completed">[] = [
    {
      key: "projects",
      label: "Create a project",
      detail: "Add a construction site, its code and project budget.",
      to: "/projects",
      permission: "projects.manage",
    },
    {
      key: "categories",
      label: "Set up material categories",
      detail: "Create your material groups before entering cement, steel or fittings.",
      to: "/materials",
      permission: "materials.manage",
    },
    {
      key: "materials",
      label: "Add construction materials",
      detail: "Choose units, reorder levels and HSN/SAC details.",
      to: "/materials",
      permission: "materials.manage",
    },
    {
      key: "vendors",
      label: "Register suppliers",
      detail: "Record supplier identity and payment terms.",
      to: "/vendors",
      permission: "vendors.manage",
    },
    {
      key: "warehouses",
      label: "Configure site stores",
      detail: "Create central or project-linked storage locations.",
      to: "/warehouses",
      permission: "warehouses.manage",
    },
  ];
  return steps.map(step => ({ ...step, completed: Number(counts[step.key]) > 0 }));
}

export function setupCompletion(counts: SetupCounts): { completed: number; total: number; ready: boolean } {
  const steps = setupSteps(counts);
  const completed = steps.filter(step => step.completed).length;
  return { completed, total: steps.length, ready: completed === steps.length };
}
