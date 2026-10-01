import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Stat, Loading } from "@/components/erp/common";
import { inrShort } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/_shell/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — KK Group ERP" }, { name: "description", content: "Inventory overview." }, { property: "og:title", content: "Dashboard — KK Group ERP" }, { property: "og:description", content: "Inventory overview." }] }),
  component: Dashboard,
});

function Dashboard() {
  const q = useQuery({
    queryKey: ["dash"],
    queryFn: async () => {
      const [p, s] = await Promise.all([
        supabase.from("projects").select("id,status"),
        supabase.from("v_building_stats").select("*"),
      ]);
      if (p.error) throw p.error;
      if (s.error) throw s.error;
      const sum = (k: string) => (s.data ?? []).reduce((a, r) => a + Number((r as Record<string, unknown>)[k] ?? 0), 0);
      return {
        projects: p.data.length,
        active: p.data.filter((x) => x.status === "under_construction" || x.status === "near_completion").length,
        buildings: s.data.length,
        total: sum("total_units"), available: sum("available_units"), hold: sum("hold_units"),
        booked: sum("booked_units"), sold: sum("sold_units"), value: sum("inventory_value"), unsold: sum("unsold_value"),
      };
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="text-sm text-destructive">{q.error.message}</div>;
  const d = q.data!;
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live inventory position across projects" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
        <Stat label="Total projects" value={d.projects} />
        <Stat label="Active projects" value={d.active} />
        <Stat label="Buildings" value={d.buildings} />
        <Stat label="Total units" value={d.total} />
        <Stat label="Available" value={d.available} />
        <Stat label="On hold" value={d.hold} />
        <Stat label="Booked" value={d.booked} hint="Bookings arrive in Phase 2" />
        <Stat label="Agreement / registered" value={d.sold} />
        <Stat label="Inventory value" value={inrShort(d.value)} />
        <Stat label="Unsold value" value={inrShort(d.unsold)} />
      </div>
    </>
  );
}
