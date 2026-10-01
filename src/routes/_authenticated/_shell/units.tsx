import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Loading, UnitStatusBadge } from "@/components/erp/common";
import { UNIT_STATUS, UNIT_TYPE_LABEL, inr, num, type UnitStatus } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/_shell/units")({
  head: () => ({ meta: [{ title: "Project Units — KK Group ERP" }, { name: "description", content: "Project unit locations for future material consumption." }, { property: "og:title", content: "Project Units — KK Group ERP" }, { property: "og:description", content: "Project unit locations for future material consumption." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Units,
});

function Units() {
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: ["units"], queryFn: async () => {
    const r = await supabase.from("units").select("*, floors(name), buildings(name), projects(name)").order("unit_number");
    if (r.error) throw r.error; return r.data;
  } });
  const rows = useMemo(() => (q.data ?? []).filter((u) => (!status || u.status === status) && u.unit_number.toLowerCase().includes(search.toLowerCase())), [q.data, status, search]);
  if (q.isLoading) return <Loading />;
  return (
    <>
      <PageHeader title="Unit Inventory" subtitle={`${rows.length} units`} />
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="h-9 rounded-md border bg-card px-3 text-sm" placeholder="Search unit no." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="h-9 rounded-md border bg-card px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(UNIT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase text-muted-foreground"><tr>{["Unit","Project","Floor","Type","Saleable sq.ft","Agreement value","Status"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id} className="border-t">
              <td className="px-3 py-2 font-mono font-medium">{u.unit_number}</td><td className="px-3 py-2">{u.projects?.name}</td>
              <td className="px-3 py-2">{u.floors?.name}</td><td className="px-3 py-2">{UNIT_TYPE_LABEL[u.unit_type]}</td>
              <td className="px-3 py-2 font-mono">{num(u.saleable_area)}</td><td className="px-3 py-2 font-mono">{inr(u.total_agreement_value)}</td>
              <td className="px-3 py-2"><UnitStatusBadge status={u.status as UnitStatus} /></td>
            </tr>))}</tbody>
        </table>
      </div>
    </>
  );
}
