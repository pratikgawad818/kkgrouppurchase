import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getVerifiedRouteUser } from "@/lib/verified-auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const user = await getVerifiedRouteUser();
    if (!user) {
      // Preserve only the internal approval deep link, never external redirects.
      if (typeof window !== "undefined" && window.location.pathname === "/approvals") {
        window.sessionStorage.setItem("kk-approval-return", window.location.pathname + window.location.search);
      }
      throw redirect({ to: "/auth" });
    }
    return { user };
  },
  component: () => <Outlet />,
});
