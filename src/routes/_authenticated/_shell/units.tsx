import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Loading, UnitStatusBadge } from "@/components/erp/common";
import { UNIT_STATUS, UNIT_TYPE_LABEL, inr, num, type UnitStatus } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_shell/units")({
  head: () => ({ meta: [{ title: "Flats Inventory — KK Group ERP" }, { name: "description", content: "Flats, shops and offices across every KK Group project and building." }, { property: "og:title", content: "Flats Inventory — KK Group ERP" }, { property: "og:description", content: "Flats, shops and offices across every KK Group project and building." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Units,
});

const sel = "h-9 w-full rounded-md border bg-card px-2 text-sm";
const inp = "h-9 w-full rounded-md border bg-card px-3 text-sm";

function Units() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"units" | "building">("units");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<any | "new" | null>(null);
  const units = useQuery({ queryKey: ["units"], queryFn: async () => {
    const r = await supabase.from("units").select("*, floors(name, floor_number), buildings(name), projects(name)").order("unit_number");
    if (r.error) throw r.error; return r.data;
  } });
  const projects = useQuery({ queryKey: ["projects-lite"], queryFn: async () => (await supabase.from("projects").select("id,name").order("name")).data ?? [] });
  const rows = useMemo(() => (units.data ?? []).filter((u) => (!project || u.project_id === project) && (!status || u.status === status) && u.unit_number.toLowerCase().includes(search.toLowerCase())), [units.data, project, status, search]);
  if (units.isLoading) return <Loading />;
  const refresh = () => qc.invalidateQueries({ queryKey: ["units"] });

  return (
    <>
      <PageHeader title="Inventory" subtitle={`${rows.length} units`} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg bg-muted p-1">
            {(["units", "building"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn("rounded-md px-4 py-1.5 text-sm font-medium transition-colors", tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t === "units" ? "Units" : "Building view"}</button>
            ))}
          </div>
          <select className="h-9 max-w-[220px] rounded-md border bg-card px-2 text-sm" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All projects</option>
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="h-9 rounded-md border bg-card px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(UNIT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input aria-label="Search unit number" className="h-11 w-full rounded-lg border bg-card px-3 text-sm sm:h-9 sm:w-40" placeholder="Search unit no." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button onClick={() => setEdit("new")}><Plus className="h-4 w-4" /> Add Unit</Button>
      </div>

      {tab === "units" ? (
        <div className="doc-table overflow-x-auto rounded-xl border bg-card shadow-card">
          {rows.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">No units match these filters.</div> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{["Unit", "Project", "Tower / Floor", "Type", "Carpet Area", "Final Price", "Status"].map((h) => <th key={h} className="px-5 py-3">{h}</th>)}</tr></thead>
              <tbody className="divide-y">{rows.map((u) => (
                <tr key={u.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setEdit(u)}>
                  <td className="px-5 py-3 font-medium">{u.unit_number}</td>
                  <td className="px-5 py-3 text-muted-foreground">{u.projects?.name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{u.buildings?.name} · {u.floors?.name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{UNIT_TYPE_LABEL[u.unit_type]}</td>
                  <td className="px-5 py-3 text-muted-foreground">{num(u.carpet_area)} sqft</td>
                  <td className="px-5 py-3 text-muted-foreground">{inr(u.total_agreement_value)}</td>
                  <td className="px-5 py-3"><UnitStatusBadge status={u.status as UnitStatus} /></td>
                </tr>))}</tbody>
            </table>)}
        </div>
      ) : <BuildingView rows={rows} onPick={setEdit} />}

      {edit && <UnitModal unit={edit === "new" ? null : edit} projects={projects.data ?? []} onClose={() => setEdit(null)} onSaved={() => { refresh(); setEdit(null); }} />}
    </>
  );
}

function BuildingView({ rows, onPick }: { rows: any[]; onPick: (u: any) => void }) {
  const byBuilding = useMemo(() => {
    const m = new Map<string, { name: string; project: string; floors: Map<number, { name: string; units: any[] }> }>();
    for (const u of rows) {
      const b = m.get(u.building_id) ?? { name: u.buildings?.name, project: u.projects?.name, floors: new Map() };
      const fn = u.floors?.floor_number ?? 0;
      const f = b.floors.get(fn) ?? { name: u.floors?.name, units: [] };
      f.units.push(u); b.floors.set(fn, f); m.set(u.building_id, b);
    }
    return [...m.values()];
  }, [rows]);
  if (!byBuilding.length) return <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">No units match these filters.</div>;
  return (
    <div className="space-y-5">
      {byBuilding.map((b) => {
        const counts = Object.keys(UNIT_STATUS).map((s) => [s, [...b.floors.values()].flatMap((f) => f.units).filter((u) => u.status === s).length] as const).filter(([, c]) => c > 0);
        return (
          <div key={b.name + b.project} className="rounded-xl border bg-card p-5 shadow-card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div><div className="font-semibold">{b.name}</div><div className="text-xs text-muted-foreground">{b.project}</div></div>
              <div className="flex flex-wrap gap-2">{counts.map(([s, c]) => <span key={s} className="flex items-center gap-1 text-xs"><UnitStatusBadge status={s as UnitStatus} /> {c}</span>)}</div>
            </div>
            <div className="space-y-2">
              {[...b.floors.entries()].sort((a, z) => z[0] - a[0]).map(([n, f]) => (
                <div key={n} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="w-24 shrink-0 text-xs font-medium uppercase text-muted-foreground">{f.name}</div>
                  <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {f.units.map((u) => (
                      <button key={u.id} onClick={() => onPick(u)} className="rounded-md border p-2 text-left hover:bg-muted/50">
                        <div className="text-sm font-medium">{u.unit_number}</div>
                        <div className="mb-1 text-[11px] text-muted-foreground">{UNIT_TYPE_LABEL[u.unit_type as keyof typeof UNIT_TYPE_LABEL]} · {num(u.carpet_area)} sqft</div>
                        <UnitStatusBadge status={u.status as UnitStatus} />
                      </button>))}
                  </div>
                </div>))}
            </div>
          </div>);
      })}
    </div>
  );
}

const L = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="space-y-1 text-sm"><span className="font-medium">{label}</span>{children}</label>;

function UnitModal({ unit, projects, onClose, onSaved }: { unit: any | null; projects: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    project_id: unit?.project_id ?? "", building_id: unit?.building_id ?? "", floor_id: unit?.floor_id ?? "",
    unit_number: unit?.unit_number ?? "", unit_type: unit?.unit_type ?? "2bhk", facing: unit?.facing ?? "",
    carpet_area: unit?.carpet_area?.toString() ?? "", built_up_area: unit?.built_up_area?.toString() ?? "", saleable_area: unit?.saleable_area?.toString() ?? "",
    base_rate: unit?.base_rate?.toString() ?? "", parking_count: unit?.parking_count?.toString() ?? "0", parking_charges: unit?.parking_charges?.toString() ?? "0", other_charges: unit?.other_charges?.toString() ?? "0", gst_rate: unit?.gst_rate?.toString() ?? "5", notes: unit?.notes ?? "",
  });
  const [newStatus, setNewStatus] = useState<string>(unit?.status ?? "available");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const buildings = useQuery({ queryKey: ["bld", f.project_id], enabled: !!f.project_id, queryFn: async () => (await supabase.from("buildings").select("id,name").eq("project_id", f.project_id).order("name")).data ?? [] });
  const floors = useQuery({ queryKey: ["flr", f.building_id], enabled: !!f.building_id, queryFn: async () => (await supabase.from("floors").select("id,name,floor_number").eq("building_id", f.building_id).order("floor_number")).data ?? [] });

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault(); setBusy(true);
    const payload = { floor_id: f.floor_id, unit_number: f.unit_number.trim(), unit_type: f.unit_type, facing: f.facing || null, carpet_area: Number(f.carpet_area), built_up_area: Number(f.built_up_area), saleable_area: Number(f.saleable_area), base_rate: Number(f.base_rate), parking_count: Number(f.parking_count) || 0, parking_charges: Number(f.parking_charges) || 0, other_charges: Number(f.other_charges) || 0, gst_rate: Number(f.gst_rate) || 0, notes: f.notes || null } as any;
    const r = unit ? await supabase.from("units").update(payload).eq("id", unit.id) : await supabase.from("units").insert({ ...payload, project_id: f.project_id, building_id: f.building_id });
    if (r.error) { setBusy(false); { toast.error(r.error.message.includes("units_building_id_unit_number_key") ? "This unit number already exists in this building." : r.error.message); return; } }
    if (unit && newStatus !== unit.status) {
      const s = await supabase.rpc("set_unit_status", { _unit_id: unit.id, _status: newStatus as UnitStatus, _reason: reason || undefined } as any);
      if (s.error) { setBusy(false); toast.error(s.error.message); return; }
    }
    setBusy(false); toast.success(unit ? "Unit updated" : "Unit added"); onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{unit ? `Edit Unit ${unit.unit_number}` : "Add Unit"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <L label="Project *"><select className={sel} required disabled={!!unit} value={f.project_id} onChange={(e) => setF((s) => ({ ...s, project_id: e.target.value, building_id: "", floor_id: "" }))}><option value="">Select project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></L>
            <L label="Tower *"><select className={sel} required disabled={!!unit} value={f.building_id} onChange={(e) => setF((s) => ({ ...s, building_id: e.target.value, floor_id: "" }))}><option value="">Select tower</option>{buildings.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></L>
            <L label="Unit number *"><input className={inp} required value={f.unit_number} onChange={(e) => set("unit_number", e.target.value)} /></L>
            <L label="Floor *"><select className={sel} required value={f.floor_id} onChange={(e) => set("floor_id", e.target.value)}><option value="">Select floor</option>{floors.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></L>
            <L label="Type"><select className={sel} value={f.unit_type} onChange={(e) => set("unit_type", e.target.value)}>{Object.entries(UNIT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></L>
            <L label="Facing"><input className={inp} value={f.facing} onChange={(e) => set("facing", e.target.value)} /></L>
            <L label="Carpet area (sqft) *"><input className={inp} type="number" step="0.01" required value={f.carpet_area} onChange={(e) => set("carpet_area", e.target.value)} /></L>
            <L label="Built-up area (sqft) *"><input className={inp} type="number" step="0.01" required value={f.built_up_area} onChange={(e) => set("built_up_area", e.target.value)} /></L>
            <L label="Saleable area (sqft) *"><input className={inp} type="number" step="0.01" required value={f.saleable_area} onChange={(e) => set("saleable_area", e.target.value)} /></L>
            <L label="Base rate (₹/sqft) *"><input className={inp} type="number" step="0.01" required value={f.base_rate} onChange={(e) => set("base_rate", e.target.value)} /></L>
            <L label="Parking count"><input className={inp} type="number" min={0} value={f.parking_count} onChange={(e) => set("parking_count", e.target.value)} /></L>
            <L label="Parking price (₹)"><input className={inp} type="number" min={0} step="0.01" value={f.parking_charges} onChange={(e) => set("parking_charges", e.target.value)} /></L>
            <L label="Other charges (₹)"><input className={inp} type="number" min={0} step="0.01" value={f.other_charges} onChange={(e) => set("other_charges", e.target.value)} /></L>
            <L label="GST (%)"><input className={inp} type="number" min={0} max={28} step="0.01" value={f.gst_rate} onChange={(e) => set("gst_rate", e.target.value)} /></L>
            {unit && <L label="Status"><select className={sel} value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>{["available", "hold", "cancelled", unit.status].filter((v, i, a) => a.indexOf(v) === i).map((k) => <option key={k} value={k}>{UNIT_STATUS[k as UnitStatus].label}</option>)}</select></L>}
          </div>
          {unit && newStatus !== unit.status && <L label="Reason for status change *"><input className={inp} required value={reason} onChange={(e) => setReason(e.target.value)} /></L>}
          <L label="Notes"><textarea className="min-h-16 w-full rounded-md border bg-card px-3 py-2 text-sm" value={f.notes} onChange={(e) => set("notes", e.target.value)} /></L>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : unit ? "Save changes" : "Add Unit"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
