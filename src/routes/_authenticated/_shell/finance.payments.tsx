import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_shell/finance/payments")({
  validateSearch: (s: Record<string, unknown>): { vendor?: string } => typeof s["vendor"] === "string" ? { vendor: s["vendor"] } : {},
  component: Outlet,
});
