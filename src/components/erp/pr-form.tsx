import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loading } from "@/components/erp/common";
import { errMsg, inr, num } from "@/lib/format";
import { PR_PRIORITY, PR_TYPE, type PrPriority, type PrType } from "@/lib/pr";

export type PrLine = { material_id: string; description: string; quantity: string; unit_id: string; estimated_rate: string; required_by: string; notes: string };
export type PrHeader = { project_id: string; building_id: string; floor_id: string; required_by: string; priority: PrPriority; request_type: PrType; purpose: string; remarks: string };

const blankLine: PrLine = { material_id: "", description: "", quantity: "", unit_id: "", estimated_rate: "", required_by: "", notes: "" };
const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export function PrForm({ id, initial, initialLines }: { id?: string; initial?: PrHeader; initialLines?: PrLine[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [h, setH] = useState<PrHeader>(initial ?? { project_id: "", building_id: "", floor_id: "", required_by: "", priority: "normal", request_type: "material", purpose: "", remarks: "" });
  const [lines, setLines] = useState<PrLine[]>(initialLines?.length ? initialLines : [{ ...blankLine }]);

  const refs = useQuery({
    queryKey: ["pr-refs"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const [p, b, f, m, u, perm] = await Promise.all([
        supabase.from("projects").select("id,name,code").eq("record_status", "active").order("name"),
        supabase.from("buildings").select("id,name,project_id").order("name"),
        supabase.from("floors").select("id,name,building_id,floor_number").order("floor_number"),
        supabase.from("items").select("id,code,name,unit_id,minimum_stock,reorder_level,item_categories(name),units_of_measure(code)").eq("status", "active").order("name"),
        supabase.from("units_of_measure").select("id,code").eq("status", "active").order("code"),
        supabase.rpc("has_permission", { _user_id: auth.user!.id, _code: "projects.view_all" }),
      ]);
      for (const r of [p, b, f, m, u]) if (r.error) throw r.error;
      let projects = p.data ?? [];
      if (!perm.data) {
        const a = await supabase.from("user_project_assignments").select("project_id").eq("user_id", auth.user!.id);
        const ok = new Set((a.data ?? []).map((x) => x.project_id));
        projects = projects.filter((x) => ok.has(x.id));
      }
      return { projects, buildings: b.data ?? [], floors: f.data ?? [], materials: m.data ?? [], units: u.data ?? [] };
    },
  });

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.estimated_rate) || 0), 0), [lines]);

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      if (!h.project_id) throw new Error("Select a project.");
      if (!h.required_by) throw new Error("Enter the required-by date.");
      const valid = lines.filter((l) => l.material_id);
      if (submit) {
        if (!valid.length) throw new Error("Add at least one item.");
        if (!h.purpose.trim()) throw new Error("Purpose is required to submit.");
      }
      for (const l of valid) {
        if (!(Number(l.quantity) > 0)) throw new Error("Each item needs a quantity greater than 0.");
        if (!l.unit_id) throw new Error("Each item needs a unit.");
      }
      const header = { project_id: h.project_id, building_id: h.building_id || null, floor_id: h.floor_id || null, required_by: h.required_by, priority: h.priority, request_type: h.request_type, purpose: h.purpose.trim() || null, remarks: h.remarks.trim() || null };
      let prId = id;
      if (prId) {
        const { error } = await supabase.from("purchase_requests").update(header).eq("id", prId);
        if (error) throw error;
        const d = await supabase.from("purchase_request_items").delete().eq("purchase_request_id", prId);
        if (d.error) throw d.error;
      } else {
        const { data: auth } = await supabase.auth.getUser();
        const { data, error } = await supabase.from("purchase_requests").insert({ ...header, requested_by: auth.user!.id, company_id: "00000000-0000-0000-0000-000000000000", pr_number: "auto" }).select("id").single();
        if (error) throw error;
        prId = data.id;
      }
      if (valid.length) {
        const { error } = await supabase.from("purchase_request_items").insert(valid.map((l, i) => ({ purchase_request_id: prId!, line_no: i + 1, material_id: l.material_id, description: l.description || null, quantity: Number(l.quantity), unit_id: l.unit_id, estimated_rate: l.estimated_rate === "" ? null : Number(l.estimated_rate), required_by: l.required_by || null, notes: l.notes || null })));
        if (error) throw error;
      }
      if (submit) {
        const { error } = await supabase.rpc("pr_transition", { _pr_id: prId!, _action: "submitted" });
        if (error) throw error;
      }
      return prId!;
    },
    onSuccess: (prId, submit) => {
      toast.success(submit ? "Submitted for approval" : "Draft saved");
      qc.invalidateQueries({ queryKey: ["prs"] });
      qc.invalidateQueries({ queryKey: ["pr", prId] });
      navigate({ to: "/procurement/purchase-requests/$id", params: { id: prId } });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (refs.isLoading) return <Loading />;
  if (refs.error) return <div className="text-sm text-destructive">{errMsg(refs.error)}</div>;
  const r = refs.data!;
  const buildings = r.buildings.filter((b) => b.project_id === h.project_id);
  const floors = r.floors.filter((f) => f.building_id === h.building_id);
  const setLine = (i: number, patch: Partial<PrLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(false); }} className="space-y-6">
      {r.projects.length === 0 && <div className="rounded-md border bg-card p-3 text-sm text-muted-foreground">You are not assigned to any project yet. Ask an administrator to assign you before raising requests.</div>}
      <section className="rounded-md border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Request information</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label>Project *</Label><select className={sel} value={h.project_id} onChange={(e) => setH({ ...h, project_id: e.target.value, building_id: "", floor_id: "" })}><option value="">Select project</option>{r.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></div>
          <div><Label>Building</Label><select className={sel} value={h.building_id} disabled={!h.project_id} onChange={(e) => setH({ ...h, building_id: e.target.value, floor_id: "" })}><option value="">—</option>{buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <div><Label>Floor</Label><select className={sel} value={h.floor_id} disabled={!h.building_id} onChange={(e) => setH({ ...h, floor_id: e.target.value })}><option value="">—</option>{floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
          <div><Label>Required by *</Label><Input type="date" value={h.required_by} onChange={(e) => setH({ ...h, required_by: e.target.value })} /></div>
          <div><Label>Priority</Label><select className={sel} value={h.priority} onChange={(e) => setH({ ...h, priority: e.target.value as PrPriority })}>{Object.entries(PR_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><Label>Request type</Label><select className={sel} value={h.request_type} onChange={(e) => setH({ ...h, request_type: e.target.value as PrType })}>{Object.entries(PR_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="sm:col-span-2"><Label>Purpose *</Label><Input value={h.purpose} onChange={(e) => setH({ ...h, purpose: e.target.value })} placeholder="e.g. 5th floor slab work" /></div>
          <div className="sm:col-span-2 lg:col-span-4"><Label>Remarks</Label><Textarea rows={2} value={h.remarks} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></div>
        </div>
      </section>

      <section className="rounded-md border bg-card p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Items</h2><Button type="button" size="sm" variant="outline" onClick={() => setLines([...lines, { ...blankLine }])}><Plus className="h-4 w-4" />Add item</Button></div>
        <div className="space-y-3">
          {lines.map((l, i) => {
            const m = r.materials.find((x) => x.id === l.material_id);
            const amt = (Number(l.quantity) || 0) * (Number(l.estimated_rate) || 0);
            return (
              <div key={i} className="rounded-md border p-3">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-12">
                  <div className="lg:col-span-4"><Label>Material</Label><select className={sel} value={l.material_id} onChange={(e) => { const mm = r.materials.find((x) => x.id === e.target.value); setLine(i, { material_id: e.target.value, unit_id: mm?.unit_id ?? "" }); }}><option value="">Select material</option>{r.materials.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></div>
                  <div className="lg:col-span-2"><Label>Quantity</Label><Input type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></div>
                  <div className="lg:col-span-1"><Label>Unit</Label><select className={sel} value={l.unit_id} onChange={(e) => setLine(i, { unit_id: e.target.value })}><option value="">—</option>{r.units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}</select></div>
                  <div className="lg:col-span-2"><Label>Est. rate (₹)</Label><Input type="number" min="0" step="any" value={l.estimated_rate} onChange={(e) => setLine(i, { estimated_rate: e.target.value })} /></div>
                  <div className="lg:col-span-2"><Label>Required by</Label><Input type="date" value={l.required_by} onChange={(e) => setLine(i, { required_by: e.target.value })} /></div>
                  <div className="flex items-end lg:col-span-1"><Button type="button" size="icon" variant="ghost" aria-label="Remove item" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></div>
                  <div className="sm:col-span-2 lg:col-span-12"><Input placeholder="Description / specification (optional)" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></div>
                </div>
                {m && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Category: {m.item_categories?.name ?? "—"}</span>
                    <span>Unit: {m.units_of_measure?.code}</span>
                    <span>Minimum stock: {num(m.minimum_stock)}</span>
                    <span>Reorder level: {num(m.reorder_level)}</span>
                    <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Current stock is tracked from Phase 4 (Goods Received) — check the store before raising.</span>
                    <span className="ml-auto font-mono text-foreground">Est. {inr(amt)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex justify-end text-sm"><span className="text-muted-foreground">Estimated Value&nbsp;</span><span className="font-mono font-semibold">{inr(total)}</span></div>
        <p className="mt-1 text-right text-[11px] text-muted-foreground">Estimate only — not an accounting entry.</p>
      </section>

      <div className="flex justify-end gap-2">
        <Button type="submit" variant="outline" disabled={save.isPending}>Save draft</Button>
        <Button type="button" disabled={save.isPending} onClick={() => save.mutate(true)}>Submit for approval</Button>
      </div>
    </form>
  );
}
