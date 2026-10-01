import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Pill, Loading, Field } from "@/components/erp/common";
import { PROJECT_STATUS_LABEL, fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/_shell/projects")({
  head: () => ({ meta: [{ title: "Projects — KK Group ERP" }, { name: "description", content: "Project master." }, { property: "og:title", content: "Projects — KK Group ERP" }, { property: "og:description", content: "Project master." }] }),
  component: Projects,
});

function Projects() {
  const q = useQuery({ queryKey: ["projects"], queryFn: async () => { const r = await supabase.from("projects").select("*").order("name"); if (r.error) throw r.error; return r.data; } });
  if (q.isLoading) return <Loading />;
  return (
    <>
      <PageHeader title="Projects" subtitle={`${q.data?.length ?? 0} projects`} />
      <div className="grid gap-4 md:grid-cols-2">
        {q.data?.map((p) => (
          <div key={p.id} className="rounded-md border bg-card p-5">
            <div className="flex items-center justify-between"><div className="font-semibold">{p.name} <span className="font-mono text-xs text-muted-foreground">{p.code}</span></div><Pill>{PROJECT_STATUS_LABEL[p.status]}</Pill></div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Location">{[p.location, p.city].filter(Boolean).join(", ")}</Field>
              <Field label="RERA no.">{p.rera_number}</Field>
              <Field label="Start">{fmtDate(p.start_date)}</Field>
              <Field label="Expected completion">{fmtDate(p.expected_completion_date)}</Field>
              <Field label="Architect">{p.architect}</Field>
              <Field label="RERA valid until">{fmtDate(p.rera_valid_until)}</Field>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
