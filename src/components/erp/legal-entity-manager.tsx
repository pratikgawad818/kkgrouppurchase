import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Plus, Save, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { errMsg } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export type LegalEntity = {
  id: string;
  company_id: string;
  code: string;
  display_name: string;
  legal_name: string | null;
  gstin: string | null;
  pan: string | null;
  registered_address: string | null;
  billing_address: string | null;
  office_address: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
};
type ProjectRecord = {
  id: string; code: string; name: string; company_id: string;
  legal_entity_id: string | null;
};

type LegalEntityForm = {
  code: string; display_name: string; legal_name: string;
  gstin: string; pan: string; registered_address: string;
  billing_address: string;
  office_address: string; phone: string; email: string;
  is_active: boolean;
};
const EMPTY: LegalEntityForm = {
  code: "", display_name: "", legal_name: "", gstin: "", pan: "",
  registered_address: "", billing_address: "", office_address: "", phone: "", email: "", is_active: true,
};
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const clean = (value: string): string | null => value.trim() || null;

// The new legal_entities table and project.legal_entity_id column will be
// reflected in the generated Supabase types after the next schema refresh.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function isLegalEntityReady(entity: Pick<LegalEntity, "is_active" | "legal_name" | "gstin" | "billing_address">) {
  return entity.is_active &&
    !!entity.legal_name?.trim() &&
    !!entity.gstin?.match(GSTIN_PATTERN) &&
    !!entity.billing_address?.trim();
}

export function LegalEntityManager({
  companyId, editable,
}: { companyId: string; editable: boolean }) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LegalEntityForm>(EMPTY);
  const [showEditor, setShowEditor] = useState(false);
  const entities = useQuery({
    queryKey: ["legal-entities", companyId],
    queryFn: async (): Promise<LegalEntity[]> => {
      const { data, error } = await db.from("legal_entities")
        .select("id,company_id,code,display_name,legal_name,gstin,pan,registered_address,billing_address,office_address,phone,email,is_active")
        .eq("company_id", companyId).order("display_name");
      if (error) throw error;
      return (data ?? []) as LegalEntity[];
    },
  });
  const projects = useQuery({
    queryKey: ["legal-entity-projects", companyId],
    queryFn: async (): Promise<ProjectRecord[]> => {
      const { data, error } = await db.from("projects")
        .select("id,code,name,company_id,legal_entity_id")
        .eq("company_id", companyId).order("name");
      if (error) throw error;
      return (data ?? []) as ProjectRecord[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!editable) throw new Error("Only Super Admin can manage legal entities.");
      const code = form.code.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{2,20}$/.test(code))
        throw new Error("Enter a code (2–20 letters, numbers, underscores or hyphens).");
      if (!form.display_name.trim()) throw new Error("Enter a legal-entity display name.");
      const gstin = clean(form.gstin.toUpperCase());
      const pan = clean(form.pan.toUpperCase());
      if (gstin && !GSTIN_PATTERN.test(gstin))
        throw new Error("Enter a valid 15-character GSTIN or leave it blank until verified.");
      if (gstin && pan && pan !== gstin.slice(2, 12))
        throw new Error("PAN and the PAN embedded in GSTIN do not match.");
      const payload = {
        code,
        display_name: form.display_name.trim(),
        legal_name: clean(form.legal_name),
        gstin,
        pan,
        registered_address: clean(form.registered_address),
        billing_address: clean(form.billing_address),
        office_address: clean(form.office_address),
        phone: clean(form.phone),
        email: clean(form.email),
        is_active: form.is_active,
      };
      const result = editingId
        ? await db.from("legal_entities").update({ ...payload, updated_at: new Date().toISOString() })
            .eq("id", editingId).eq("company_id", companyId)
        : await db.from("legal_entities").insert({ ...payload, company_id: companyId });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["legal-entities", companyId] });
      setShowEditor(false);
      setEditingId(null);
      toast.success("Legal entity saved. Historical PO buyer snapshots were not changed.");
    },
    onError: (error) => toast.error(errMsg(error)),
  });

  const assign = useMutation({
    mutationFn: async ({ projectId, entityId }: { projectId: string; entityId: string | null }) => {
      if (!editable) throw new Error("Only Super Admin can assign legal entities.");
      const selected = entities.data?.find((x) => x.id === entityId);
      if (entityId && (!selected || !selected.is_active))
        throw new Error("Select an active legal entity in the same company.");
      const { error } = await db.from("projects")
        .update({ legal_entity_id: entityId }).eq("id", projectId).eq("company_id", companyId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["legal-entity-projects", companyId] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
      ]);
      toast.success("Project legal entity updated. Existing POs retain their original buyer identity.");
    },
    onError: (error) => toast.error(errMsg(error)),
  });

  const startNew = () => {
    setEditingId(null);
    setForm(EMPTY);
    setShowEditor(true);
  };
  const startEdit = (entity: LegalEntity) => {
    setEditingId(entity.id);
    setForm({
      code: entity.code, display_name: entity.display_name,
      legal_name: entity.legal_name ?? "", gstin: entity.gstin ?? "",
      pan: entity.pan ?? "", registered_address: entity.registered_address ?? "",
      billing_address: entity.billing_address ?? "",
      office_address: entity.office_address ?? "", phone: entity.phone ?? "",
      email: entity.email ?? "", is_active: entity.is_active,
    });
    setShowEditor(true);
  };
  const pending = entities.data?.filter((e) => !isLegalEntityReady(e)) ?? [];

  return (
    <section className="mx-auto mt-6 max-w-5xl space-y-5 rounded-lg border bg-card p-4 shadow-card sm:p-6"
      aria-labelledby="legal-entities-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="legal-entities-heading" className="text-base font-semibold">Legal entities &amp; project GST</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              One KK Group workspace, separate registered buyers. New POs use
              the project's assigned legal name, GSTIN and billing address.
              Existing issued documents are not rewritten.
            </p>
          </div>
        </div>
        {editable && <Button size="sm" type="button" variant="outline"
          onClick={startNew}><Plus className="mr-1 h-4 w-4" />Add legal entity</Button>}
      </div>

      {entities.error && <p role="alert" className="text-sm text-destructive">
        Could not load legal entities: {errMsg(entities.error)}</p>}
      {projects.error && <p role="alert" className="text-sm text-destructive">
        Could not load project assignments: {errMsg(projects.error)}</p>}
      {pending.length > 0 && <p role="status" className="rounded-lg border border-amber-300/60 bg-amber-50/50 p-3 text-xs text-foreground dark:bg-amber-950/10">
        <ShieldCheck className="mr-1 inline h-4 w-4" aria-hidden="true" />
        <strong>{pending.length} legal {pending.length === 1 ? "entity needs" : "entities need"} official details.</strong>
        {" "}New POs for those projects cannot be created until their legal name,
        GSTIN and billing address are entered.
      </p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(entities.data ?? []).map((entity) => (
          <div key={entity.id} className="min-w-0 rounded-xl border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <strong className="text-sm">{entity.display_name}</strong>
              <span className={isLegalEntityReady(entity)
                ? "rounded-full bg-emerald-100 px-2 py-1 text-[11px] text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                : "rounded-full bg-amber-100 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200"}>
                {isLegalEntityReady(entity) ? "Ready for PO" : "GST details pending"}
              </span>
            </div>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p className="break-words">{entity.legal_name || "Legal name not verified"}</p>
              <p className="font-mono">{entity.gstin || "GSTIN not entered"}</p>
              <p className="break-words">Bill to: {entity.billing_address || "Billing address pending"}</p>
              <p className="break-words">Registered: {entity.registered_address || "Not supplied"}</p>
              <p>{(projects.data ?? []).filter((p) => p.legal_entity_id === entity.id).length} assigned project(s)</p>
            </div>
            {editable && <Button type="button" variant="outline" size="sm"
              className="mt-3 min-h-10" onClick={() => startEdit(entity)}>Edit official details</Button>}
          </div>
        ))}
      </div>

      {showEditor && editable && <form className="space-y-4 rounded-xl border bg-muted/20 p-4"
        onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <div className="flex justify-between gap-3">
          <h3 className="font-semibold">{editingId ? "Edit legal entity" : "Add legal entity"}</h3>
          <Button type="button" variant="ghost" onClick={() => setShowEditor(false)}>Close</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="legal-entity-code">Code *</Label>
            <Input id="legal-entity-code" required maxLength={20}
              value={form.code} disabled={!!editingId}
              onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div><Label htmlFor="legal-entity-display">Display name *</Label>
            <Input id="legal-entity-display" required
              value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
          <div><Label htmlFor="legal-entity-name">Official legal name</Label>
            <Input id="legal-entity-name" value={form.legal_name}
              onChange={(e) => setForm({ ...form, legal_name: e.target.value })} /></div>
          <div><Label htmlFor="legal-entity-gstin">GSTIN (15 characters)</Label>
            <Input id="legal-entity-gstin" autoCapitalize="characters" maxLength={15}
              value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} /></div>
          <div><Label htmlFor="legal-entity-pan">PAN</Label>
            <Input id="legal-entity-pan" maxLength={10} value={form.pan}
              onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} /></div>
          <div><Label htmlFor="legal-entity-phone">Phone</Label>
            <Input id="legal-entity-phone" value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label htmlFor="legal-entity-billing-address">Billing address (Bill To) *</Label>
            <Textarea id="legal-entity-billing-address" rows={2} required
              value={form.billing_address} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label htmlFor="legal-entity-address">Registered address (if verified; can differ)</Label>
            <Textarea id="legal-entity-address" rows={2}
              value={form.registered_address} onChange={(e) => setForm({ ...form, registered_address: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label htmlFor="legal-entity-office">Office address</Label>
            <Textarea id="legal-entity-office" rows={2}
              value={form.office_address} onChange={(e) => setForm({ ...form, office_address: e.target.value })} /></div>
          <div><Label htmlFor="legal-entity-email">Email</Label>
            <Input id="legal-entity-email" type="email" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}/>
            Active purchasing entity
          </label>
        </div>
        <Button type="submit" disabled={save.isPending}><Save className="mr-2 h-4 w-4"/>
          {save.isPending ? "Saving…" : "Save legal entity"}</Button>
      </form>}

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold">Project → purchasing legal entity</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Project assignment is controlled by Super Admin. It affects only
          future POs; earlier PO buyer snapshots remain unchanged.
        </p>
        <div className="mt-3 space-y-2">
          {(projects.data ?? []).map((project) => {
            const current = entities.data?.find((e) => e.id === project.legal_entity_id);
            return <div key={project.id}
              className="flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">{project.name}</p>
                <p className="text-xs text-muted-foreground">
                  {current?.display_name || "Unassigned — new POs blocked"}
                  {current && !isLegalEntityReady(current) ? " · GST details pending" : ""}
                </p>
              </div>
              {editable && <select className="min-h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-60"
                aria-label={`Legal entity for ${project.name}`}
                disabled={assign.isPending || entities.isLoading}
                value={project.legal_entity_id ?? ""}
                onChange={(event) => assign.mutate({
                  projectId: project.id, entityId: event.target.value || null,
                })}>
                <option value="">Not assigned</option>
                {(entities.data ?? []).filter((x) => x.is_active || x.id === project.legal_entity_id)
                  .map((x) => <option key={x.id} value={x.id}>{x.display_name}</option>)}
              </select>}
            </div>;
          })}
        </div>
      </div>
    </section>
  );
}
