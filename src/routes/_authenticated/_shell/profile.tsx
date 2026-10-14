import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Lock, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { useAvatarUrl } from "@/lib/avatar";
import { ROLE_LABEL } from "@/lib/format";
import { PageHeader, Field, Loading, Pill } from "@/components/erp/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/_shell/profile")({
  head: () => ({ meta: [{ title: "My Profile · KK GROUP ERP" }, { name: "description", content: "View and update your KK GROUP ERP staff profile." }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const me = useMe();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ full_name: "", email: "", phone: "", dob: "", department: "", designation: "", avatar_url: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const p = me.data?.profile;

  useEffect(() => {
    if (!p) return;
    setF({ full_name: p.full_name ?? "", email: p.email ?? "", phone: p.phone ?? "", dob: p.dob ?? "",
      department: p.department ?? "", designation: p.designation ?? "", avatar_url: p.avatar_url ?? "" });
  }, [p]);
  const avatar = useAvatarUrl(f.avatar_url || null);

  if (me.isLoading || !p) return <Loading />;
  const uid = p.id; const currentEmail = p.email ?? "";
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function persist(next: typeof f) {
    const { error } = await supabase.rpc("update_my_profile", {
      _full_name: next.full_name, _phone: next.phone, _dob: (next.dob || null) as string,
      _department: next.department, _designation: next.designation, _avatar_url: next.avatar_url,
    });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["me"] });
  }

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file."); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Photo must be under 5 MB."); return; }
    setUploading(true);
    try {
      const path = `${uid}/${Date.now()}.${file.name.split(".").pop() || "jpg"}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const old = f.avatar_url;
      const next = { ...f, avatar_url: path };
      await persist(next); setF(next);
      if (old) await supabase.storage.from("avatars").remove([old]);
      toast.success("Profile photo updated");
    } catch (e) { toast.error((e as Error).message); } finally { setUploading(false); }
  }

  async function removePhoto() {
    const old = f.avatar_url; const next = { ...f, avatar_url: "" };
    try { await persist(next); setF(next); if (old) await supabase.storage.from("avatars").remove([old]); toast.success("Photo removed"); }
    catch (e) { toast.error((e as Error).message); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.full_name.trim()) { toast.error("Name is required."); return; }
    setSaving(true);
    try {
      await persist(f);
      const email = f.email.trim();
      if (email && email !== currentEmail) {
        const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: window.location.origin + "/auth" });
        if (error) throw error;
        toast.success("Profile saved. Check both inboxes to confirm the new email address.");
      } else toast.success("Profile saved");
    } catch (err) { toast.error((err as Error).message); } finally { setSaving(false); }
  }

  const initials = (f.full_name || f.email || "U").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const roles = me.data!.roles;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="My Profile" subtitle="Your personal details as seen by colleagues" />
      <div className="space-y-5">
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-card sm:flex-row sm:items-center">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full bg-primary text-primary-foreground">
            {avatar.data ? <img src={avatar.data} alt="Profile photo" className="h-full w-full object-cover" />
              : <span className="grid h-full w-full place-items-center text-2xl font-semibold">{initials}</span>}
          </div>
          <div className="flex-1 space-y-2">
            <div className="text-lg font-semibold">{f.full_name || "Unnamed staff"}</div>
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x) upload(x); e.target.value = ""; }} />
              <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}><Camera className="h-4 w-4" />{uploading ? "Uploading…" : f.avatar_url ? "Change photo" : "Upload photo"}</Button>
              {f.avatar_url && <Button type="button" size="sm" variant="ghost" onClick={removePhoto}><Trash2 className="h-4 w-4" />Remove</Button>}
            </div>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5 shadow-card">
          <div className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4 text-muted-foreground" />Role</div>
          <div className="mt-2 flex flex-wrap gap-2">{roles.length ? roles.map((r) => <Pill key={r}>{ROLE_LABEL[r]}</Pill>) : <span className="text-sm text-muted-foreground">No role assigned</span>}</div>
          <p className="mt-2 text-xs text-muted-foreground">Your role can only be changed by a Super Admin.</p>
        </section>

        <form onSubmit={save} className="rounded-xl border bg-card p-5 shadow-card">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><Input value={f.full_name} onChange={set("full_name")} maxLength={120} required /></Field>
            <Field label="Email address"><Input type="email" value={f.email} onChange={set("email")} maxLength={255} /></Field>
            <Field label="Phone number"><Input type="tel" value={f.phone} onChange={set("phone")} maxLength={20} /></Field>
            <Field label="Date of birth"><Input type="date" value={f.dob} max={new Date().toISOString().slice(0, 10)} onChange={set("dob")} /></Field>
            <Field label="Department"><Input value={f.department} onChange={set("department")} maxLength={100} /></Field>
            <Field label="Designation"><Input value={f.designation} onChange={set("designation")} maxLength={100} /></Field>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Changing your email sends a confirmation link; your sign-in email changes only after you confirm it.</p>
          <div className="mt-4 flex justify-end"><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button></div>
        </form>
      </div>
    </div>
  );
}
