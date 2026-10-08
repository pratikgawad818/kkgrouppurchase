import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Loading, Progress, Pill } from "@/components/erp/common";
import { WORK_STATUS_LABEL, inrShort, type WorkStatus } from "@/lib/format";
import { useCan } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/_shell/buildings")({
  head: () => ({ meta: [{ title: "Buildings — KK Group ERP" }, { name: "description", content: "Project buildings and wings." }, { property: "og:title", content: "Buildings — KK Group ERP" }, { property: "og:description", content: "Project buildings and wings." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Buildings,
});

const empty = { project_id: "", code: "", name: "", wing: "", planned_floors: "0", construction_start: "", expected_completion: "", budget: "0", progress_pct: "0", status: "not_started" as WorkStatus, notes: "" };

function Buildings() {
  const can = useCan(), qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const q = useQuery({ queryKey: ["buildings"], queryFn: async () => {
    const [b, s] = await Promise.all([supabase.from("buildings").select("*, projects(name)").order("code"), supabase.from("v_building_stats").select("*")]);
    if (b.error) throw b.error;
    return b.data.map((x) => ({ ...x, stats: s.data?.find((r) => r.building_id === x.id) }));
  } });
  const projects = useQuery({ queryKey: ["projects-lite"], queryFn: async () => {
    const r = await supabase.from("projects").select("id,name").order("name");
    if (r.error) throw r.error;
    return r.data;
  } });
  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        project_id: form.project_id, code: form.code.trim(), name: form.name.trim(), wing: form.wing || null,
        planned_floors: Number(form.planned_floors), construction_start: form.construction_start || null,
        expected_completion: form.expected_completion || null, budget: Number(form.budget),
        progress_pct: Number(form.progress_pct), status: form.status, notes: form.notes || null,
      };
      const r = editingId ? await supabase.from("buildings").update(payload).eq("id", editingId) : await supabase.from("buildings").insert(payload);
      if (r.error) throw r.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["buildings"] }); setOpen(false); toast.success(editingId ? "Building updated" : "Building created"); },
    onError: (e) => toast.error(e.message.includes("buildings_project_id_code_key") ? "This project already has a building with that code. Use a different code (e.g. B, C, T2)." : e.message),
  });
  const manage = can("buildings.manage");
  type B = NonNullable<typeof q.data>[number];
  function show(b?: B) {
    setEditingId(b?.id ?? null);
    setForm(b ? { project_id: b.project_id, code: b.code, name: b.name, wing: b.wing ?? "", planned_floors: String(b.planned_floors), construction_start: b.construction_start ?? "", expected_completion: b.expected_completion ?? "", budget: String(b.budget), progress_pct: String(b.progress_pct), status: b.status, notes: b.notes ?? "" } : empty);
    setOpen(true);
  }
  if (q.isLoading) return <Loading />;
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <PageHeader title="Buildings" actions={manage && <Button size="sm" onClick={() => show()}><Plus className="h-4 w-4" />New building</Button>} />
      <div className="overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase text-muted-foreground"><tr>{["Building","Project","Floors","Units","Available","Hold","Budget","Progress","Status", ...(manage ? [""] : [])].map((h, i) => <th key={i} className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>{q.data?.map((b) => (
            <tr key={b.id} className="border-t">
              <td className="px-3 py-2 font-medium">{b.name}</td><td className="px-3 py-2">{b.projects?.name}</td>
              <td className="px-3 py-2 font-mono">{b.planned_floors}</td><td className="px-3 py-2 font-mono">{b.stats?.total_units}</td>
              <td className="px-3 py-2 font-mono">{b.stats?.available_units}</td><td className="px-3 py-2 font-mono">{b.stats?.hold_units}</td>
              <td className="px-3 py-2 font-mono">{inrShort(b.budget)}</td><td className="w-40 px-3 py-2"><Progress value={Number(b.progress_pct)} /></td>
              <td className="px-3 py-2"><Pill>{WORK_STATUS_LABEL[b.status]}</Pill></td>
              {manage && <td className="px-3 py-2 text-right"><Button variant="ghost" size="icon" onClick={() => show(b)} aria-label={`Edit ${b.name}`}><Pencil className="h-4 w-4" /></Button></td>}
            </tr>))}</tbody>
        </table>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editingId ? "Edit building" : "New building"}</DialogTitle><DialogDescription>Building or wing details within a project.</DialogDescription></DialogHeader>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="sm:col-span-2"><Label>Project</Label><select required className="h-9 w-full rounded-lg border bg-background px-3 text-sm" value={form.project_id} onChange={set("project_id")}><option value="">Select project</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><Label>Building code</Label><Input required value={form.code} maxLength={6} placeholder="e.g. A, B, T1" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} /><p className="mt-1 text-xs text-muted-foreground">Up to 6 letters/numbers; must differ from other buildings in the same project.</p></div>
            <div><Label>Building name</Label><Input required value={form.name} onChange={set("name")} /></div>
            <div><Label>Wing</Label><Input value={form.wing} onChange={set("wing")} /></div>
            <div><Label>Planned floors</Label><Input type="number" min="0" value={form.planned_floors} onChange={set("planned_floors")} /></div>
            <div><Label>Construction start</Label><Input type="date" value={form.construction_start} onChange={set("construction_start")} /></div>
            <div><Label>Expected completion</Label><Input type="date" value={form.expected_completion} onChange={set("expected_completion")} /></div>
            <div><Label>Budget</Label><Input type="number" min="0" value={form.budget} onChange={set("budget")} /></div>
            <div><Label>Progress %</Label><Input type="number" min="0" max="100" value={form.progress_pct} onChange={set("progress_pct")} /></div>
            <div><Label>Status</Label><select className="h-9 w-full rounded-lg border bg-background px-3 text-sm" value={form.status} onChange={set("status")}>{Object.entries(WORK_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="sm:col-span-2"><Label>Notes</Label><Input value={form.notes} onChange={set("notes")} /></div>
            <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={save.isPending}>Save building</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
