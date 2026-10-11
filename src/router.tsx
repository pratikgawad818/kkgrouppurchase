import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Sidebar hover/focus preloads route chunks for a snappier click.
    // Individual TanStack Query screens still enforce their own freshness.
    defaultPreloadStaleTime: 15_000,
    defaultPendingMs: 180,
    defaultPendingMinMs: 200,
  });

  return router;
};
