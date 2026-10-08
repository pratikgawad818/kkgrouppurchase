import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      // Preserve only the internal approval deep link, never external redirects.
      if (typeof window !== "undefined" && window.location.pathname === "/approvals") {
        window.sessionStorage.setItem("kk-approval-return", window.location.pathname + window.location.search);
      }
      throw redirect({ to: "/auth" });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
