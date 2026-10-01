import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Loading, Pill } from "@/components/erp/common";
import { ROLE_LABEL, type AppRole } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/_shell/settings/users")({
  head: () => ({ meta: [{ title: "Users — KK Group ERP" }, { name: "description", content: "Users and roles." }, { property: "og:title", content: "Users" }, { property: "og:description", content: "Users and roles." }] }),
  component: UsersPage,
});

function UsersPage() {
  const q = useQuery({ queryKey: ["users"], queryFn: async () => {
    const [p, r] = await Promise.all([supabase.from("profiles").select("*"), supabase.from("user_roles").select("*")]);
    if (p.error) throw p.error;
    return p.data.map((x) => ({ ...x, roles: (r.data ?? []).filter((y) => y.user_id === x.id).map((y) => y.role as AppRole) }));
  } });
  if (q.isLoading) return <Loading />;
  return (
    <>
      <PageHeader title="Users & Permissions" />
      <div className="rounded-md border bg-card">
        {q.data?.map((u) => (
          <div key={u.id} className="flex items-center justify-between border-b px-4 py-3 last:border-0">
            <div><div className="font-medium">{u.full_name}</div><div className="text-xs text-muted-foreground">{u.email}</div></div>
            <div className="flex gap-1">{u.roles.map((r) => <Pill key={r}>{ROLE_LABEL[r]}</Pill>)}</div>
          </div>
        ))}
      </div>
    </>
  );
}
