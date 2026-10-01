import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Loading, Progress, Pill } from "@/components/erp/common";
import { WORK_STATUS_LABEL, inrShort } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/_shell/buildings")({
  head: () => ({ meta: [{ title: "Buildings — KK Group ERP" }, { name: "description", content: "Buildings and wings." }, { property: "og:title", content: "Buildings — KK Group ERP" }, { property: "og:description", content: "Buildings and wings." }] }),
  component: Buildings,
});

function Buildings() {
  const q = useQuery({ queryKey: ["buildings"], queryFn: async () => {
    const [b, s] = await Promise.all([supabase.from("buildings").select("*, projects(name)").order("code"), supabase.from("v_building_stats").select("*")]);
    if (b.error) throw b.error;
    return b.data.map((x) => ({ ...x, stats: s.data?.find((r) => r.building_id === x.id) }));
  } });
  if (q.isLoading) return <Loading />;
  return (
    <>
      <PageHeader title="Buildings" />
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase text-muted-foreground"><tr>{["Building","Project","Floors","Units","Available","Hold","Budget","Progress","Status"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>{q.data?.map((b) => (
            <tr key={b.id} className="border-t">
              <td className="px-3 py-2 font-medium">{b.name}</td><td className="px-3 py-2">{b.projects?.name}</td>
              <td className="px-3 py-2 font-mono">{b.planned_floors}</td><td className="px-3 py-2 font-mono">{b.stats?.total_units}</td>
              <td className="px-3 py-2 font-mono">{b.stats?.available_units}</td><td className="px-3 py-2 font-mono">{b.stats?.hold_units}</td>
              <td className="px-3 py-2 font-mono">{inrShort(b.budget)}</td><td className="w-40 px-3 py-2"><Progress value={Number(b.progress_pct)} /></td>
              <td className="px-3 py-2"><Pill>{WORK_STATUS_LABEL[b.status]}</Pill></td>
            </tr>))}</tbody>
        </table>
      </div>
    </>
  );
}
