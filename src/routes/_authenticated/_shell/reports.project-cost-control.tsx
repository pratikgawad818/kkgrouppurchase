import { createFileRoute } from "@tanstack/react-router";
import { ProjectCostControl } from "@/components/erp/project-cost-control-panel";

// Existing bookmarks and roles with financial-only access remain supported.
export const Route = createFileRoute("/_authenticated/_shell/reports/project-cost-control")({
  head: () => ({ meta: [{ title: "Budget & commitments — KK GROUP ERP" }] }),
  component: ProjectCostControl,
});
