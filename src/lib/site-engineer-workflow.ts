import type { PurchaseChain } from "./purchase-pipeline.ts";

/**
 * Field engineers only own procurement requests, site deliveries, GRNs, stock
 * and their own small expenses. Invoice approval and supplier settlement are
 * Finance responsibilities, never tasks in their receiving dashboard.
 *
 * This is a display projection, not a grant/revocation of database rights;
 * page authorization and RLS remain the security boundary.
 */
export function isSiteEngineerFieldPortal(roles: readonly string[]): boolean {
  return roles.includes("site_engineer") &&
    !roles.some((role) => [
      "super_admin", "director", "accounts_manager", "accountant", "purchase_manager",
    ].includes(role));
}

/**
 * Once goods have been fully received/short-closed, the generic pipeline
 * advances to "Invoice" and categorizes the PO as payment work, even when
 * the engineer cannot see financial documents. Completed site work should
 * disappear from the engineer's attention queue, but stays in PO/GRN registers.
 *
 * Active procurement and receiving chains show only their four relevant
 * steps. This never removes records and doesn't change manager/finance views.
 */
export function siteEngineerAttentionTasks(
  tasks: readonly PurchaseChain[],
): PurchaseChain[] {
  return tasks
    .filter((task) => task.group !== "payments")
    .map((task) => ({
      ...task,
      steps: task.steps.filter((step) => step.key !== "invoice" && step.key !== "payment"),
    }));
}
