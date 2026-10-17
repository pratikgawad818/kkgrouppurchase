import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { useAvatarUrl } from "@/lib/avatar";
import { ROLE_LABEL } from "@/lib/format";
import { canAccessPage } from "@/lib/page-access";
import { workspaceNavigation } from "@/lib/workspace-navigation";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/erp/common";
import { NotificationBell } from "@/components/erp/notification-bell";
import { useDocTableLabels } from "@/components/erp/doc-table";
import { WorkspaceFrame } from "@/components/erp/workspace-frame";

export const Route = createFileRoute("/_authenticated/_shell")({ component: Shell });
const getMain = () =>
  typeof document === "undefined"
    ? null
    : (document.getElementById("workspace-main") ?? document.body);

function Shell() {
  const me = useMe();
  const avatar = useAvatarUrl(me.data?.profile.avatar_url ?? null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const navigating = useRouterState({ select: (state) => state.isLoading });
  const [showProgress, setShowProgress] = useState(false);
  useDocTableLabels(getMain);
  useEffect(() => {
    if (!navigating) {
      setShowProgress(false);
      return;
    }
    const timer = window.setTimeout(() => setShowProgress(true), 180);
    return () => window.clearTimeout(timer);
  }, [navigating]);
  const managementViewer = me.data?.roles.length === 1 && me.data.roles[0] === "auditor";
  useEffect(() => {
    if (path === "/dashboard" && managementViewer)
      void navigate({ to: "/management", replace: true });
  }, [path, managementViewer, navigate]);
  const isDirector = me.data?.roles.includes("director") ?? false;
  const pending = useQuery({
    queryKey: ["director-pending-count", me.data?.profile.id],
    enabled: isDirector && !!me.data?.profile.is_active,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const results = await Promise.all([
        supabase
          .from("purchase_orders")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending_approval"),
        supabase
          .from("vendor_payments")
          .select("id", { count: "exact", head: true })
          .eq("status", "scheduled"),
      ]);
      if (results.some((result) => result.error || result.count === null))
        throw new Error("Approval count is unavailable.");
      return results.reduce((sum, result) => sum + result.count!, 0);
    },
  });
  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }
  if (me.isLoading)
    return (
      <div className="p-6">
        <Loading />
      </div>
    );
  if (me.error || !me.data)
    return (
      <div role="alert" className="m-6 rounded-xl border bg-card p-6">
        <h1 className="font-semibold">Your workspace could not load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Check your connection and try again.</p>
        <Button className="mt-4" onClick={() => void me.refetch()}>
          Try again
        </Button>
      </div>
    );
  const { profile, roles, permissions } = me.data;
  const access = { roles, permissions };
  const home = managementViewer ? "/management" : "/dashboard";
  const blocked = !profile.is_active
    ? "Your account has been deactivated. Contact your administrator."
    : roles.length === 0
      ? "Your account is awaiting access. An administrator needs to assign you a role before you can use the system."
      : null;
  return (
    <WorkspaceFrame
      path={path}
      groups={blocked ? [] : workspaceNavigation(access)}
      name={profile.full_name ?? profile.email ?? "My account"}
      role={roles.map((role) => ROLE_LABEL[role]).join(", ") || "Awaiting access"}
      isDirector={isDirector}
      avatar={avatar.data}
      notifications={<NotificationBell userId={profile.id} />}
      pendingApprovals={isDirector && !pending.isError ? pending.data : undefined}
      navigating={showProgress}
      onSignOut={() => void signOut()}
    >
      {blocked ? (
        <div role="alert" className="rounded-xl border bg-card p-6 text-sm">
          {blocked}
        </div>
      ) : !canAccessPage(path, access) ? (
        <div role="alert" className="mx-auto max-w-2xl rounded-2xl border bg-card p-6">
          <h1 className="text-xl font-semibold">Access restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your assigned role does not permit access to this page. Ask your administrator if your
            responsibilities have changed.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link to={home}>Go to your dashboard</Link>
          </Button>
        </div>
      ) : (
        <Outlet />
      )}
    </WorkspaceFrame>
  );
}
