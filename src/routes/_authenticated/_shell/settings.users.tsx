import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { inviteStaff, updateStaffAccess } from "@/lib/admin.functions";
import { PageHeader, Loading, Pill } from "@/components/erp/common";
import { ROLE_LABEL, type AppRole } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/_shell/settings/users")({
  head: () => ({ meta: [{ title: "Users & Permissions — KK GROUP ERP" }, { name: "description", content: "Create staff, assign roles and control access." }, { property: "og:title", content: "Users & Permissions — KK GROUP ERP" }, { property: "og:description", content: "Create staff, assign roles and control access." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: UsersPage,
});

type Assignable = Exclude<AppRole, "super_admin" | "sales_manager" | "sales_executive">;
const ASSIGNABLE: Assignable[] = ["director", "purchase_manager", "store_manager", "accounts_manager", "accountant", "project_manager", "site_engineer", "auditor"];
type Staff = { id: string; full_name: string | null; email: string | null; phone: string | null; department: string | null; designation: string | null; is_active: boolean; roles: AppRole[] };
const blankInvite = { email: "", fullName: "", phone: "", department: "", designation: "", role: "site_engineer" as Assignable };

function RoleSelect({ value, onChange, disabled, allowNone }: { value: string; onChange: (v: string) => void; disabled?: boolean; allowNone?: boolean }) {
  return (
    <select className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {allowNone && <option value="">No role</option>}
      {ASSIGNABLE.map((r) => <option value={r} key={r}>{ROLE_LABEL[r]}</option>)}
    </select>
  );
}

function UsersPage() {
  const qc = useQueryClient();
  const run = useServerFn(updateStaffAccess);
  const invite = useServerFn(inviteStaff);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [edit, setEdit] = useState({ role: "", active: true, phone: "", department: "", designation: "" });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inv, setInv] = useState(blankInvite);

  const q = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const [p, r] = await Promise.all([
        supabase.from("profiles").select("id,full_name,email,phone,department,designation,is_active").order("full_name"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      if (p.error) throw p.error;
      if (r.error) throw r.error;
      return p.data.map((x) => ({ ...x, roles: r.data.filter((y) => y.user_id === x.id).map((y) => y.role as AppRole) })) as Staff[];
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["users"] }); qc.invalidateQueries({ queryKey: ["me"] }); };

  const save = useMutation({
    mutationFn: async () => { if (staff) await run({ data: { userId: staff.id, role: (edit.role || null) as AppRole | null, active: edit.active, phone: edit.phone, department: edit.department, designation: edit.designation } }); },
    onSuccess: () => { refresh(); setStaff(null); toast.success("Staff access updated"); },
    onError: (e) => toast.error(e.message),
  });
  const create = useMutation({
    mutationFn: async () => { await invite({ data: { ...inv, redirectTo: window.location.origin + "/reset-password" } }); },
    onSuccess: () => { refresh(); setInviteOpen(false); setInv(blankInvite); toast.success("Invitation sent"); },
    onError: (e) => toast.error(e.message),
  });

  function open(s: Staff) {
    setStaff(s);
    setEdit({ role: s.roles.find((r) => r !== "super_admin") ?? "", active: s.is_active, phone: s.phone ?? "", department: s.department ?? "", designation: s.designation ?? "" });
  }
  const isSuper = staff?.roles.includes("super_admin");

  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="text-sm text-destructive">{q.error.message}</div>;
  return (
    <>
      <PageHeader title="Users & Permissions" subtitle="Create staff accounts, assign roles and control access" actions={<Button size="sm" onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4" />Invite staff</Button>} />
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Staff member</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">Department</th><th className="px-3 py-2">Designation</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Access</th><th /></tr></thead>
          <tbody>
            {q.data?.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2"><div className="font-medium">{u.full_name || "Unnamed staff"}</div><div className="text-xs text-muted-foreground">{u.email}</div></td>
                <td className="px-3 py-2">{u.phone || "—"}</td>
                <td className="px-3 py-2">{u.department || "—"}</td>
                <td className="px-3 py-2">{u.designation || "—"}</td>
                <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{u.roles.length ? u.roles.map((r) => <Pill key={r}>{ROLE_LABEL[r]}</Pill>) : <span className="text-muted-foreground">Awaiting role</span>}</div></td>
                <td className="px-3 py-2"><Pill>{u.is_active ? "Active" : "Inactive"}</Pill></td>
                <td className="px-3 py-2 text-right"><Button variant="ghost" size="icon" aria-label={`Edit ${u.full_name ?? u.email}`} onClick={() => open(u)}><Pencil className="h-4 w-4" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!staff} onOpenChange={(o) => !o && setStaff(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Staff access</DialogTitle><DialogDescription>{staff?.full_name || staff?.email}</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Phone</Label><Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
            <div><Label>Department</Label><Input value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Designation</Label><Input value={edit.designation} onChange={(e) => setEdit({ ...edit, designation: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Operational role</Label><RoleSelect allowNone value={edit.role} onChange={(v) => setEdit({ ...edit, role: v })} disabled={isSuper} />{isSuper && <p className="mt-1 text-xs text-muted-foreground">Super Admin role is kept; contact details can still be edited.</p>}</div>
            <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2"><div><div className="text-sm font-medium">Active access</div><div className="text-xs text-muted-foreground">Inactive staff cannot use the workspace.</div></div><Switch checked={edit.active} onCheckedChange={(v) => setEdit({ ...edit, active: v })} disabled={isSuper} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setStaff(null)}>Cancel</Button><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite staff</DialogTitle><DialogDescription>They'll receive an email to set their password.</DialogDescription></DialogHeader>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <div className="sm:col-span-2"><Label>Full name</Label><Input required value={inv.fullName} onChange={(e) => setInv({ ...inv, fullName: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Email</Label><Input type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={inv.phone} onChange={(e) => setInv({ ...inv, phone: e.target.value })} /></div>
            <div><Label>Department</Label><Input value={inv.department} onChange={(e) => setInv({ ...inv, department: e.target.value })} /></div>
            <div><Label>Designation</Label><Input value={inv.designation} onChange={(e) => setInv({ ...inv, designation: e.target.value })} /></div>
            <div><Label>Role</Label><RoleSelect value={inv.role} onChange={(v) => setInv({ ...inv, role: v as Assignable })} /></div>
            <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "Sending…" : "Send invitation"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
