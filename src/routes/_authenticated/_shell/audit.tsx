import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Loading } from "@/components/erp/common";
import { fmtDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/_shell/audit")({
  head: () => ({ meta: [{ title: "Audit Log — KK Group ERP" }, { name: "description", content: "Change history." }, { property: "og:title", content: "Audit Log" }, { property: "og:description", content: "Change history." }] }),
  component: Audit,
});

function Audit() {
  const q = useQuery({ queryKey: ["audit"], queryFn: async () => { const r = await supabase.from("audit_logs").select("id,action,entity,entity_id,created_at").order("created_at", { ascending: false }).limit(200); if (r.error) throw r.error; return r.data; } });
  if (q.isLoading) return <Loading />;
  return (
    <>
      <PageHeader title="Audit Log" subtitle="Latest 200 changes" />
      <div className="rounded-md border bg-card text-sm">
        {q.data?.map((a) => <div key={a.id} className="flex gap-4 border-b px-4 py-2 font-mono text-xs last:border-0"><span className="w-40">{fmtDateTime(a.created_at)}</span><span className="w-16">{a.action}</span><span>{a.entity}</span><span className="truncate text-muted-foreground">{a.entity_id}</span></div>)}
      </div>
    </>
  );
}
