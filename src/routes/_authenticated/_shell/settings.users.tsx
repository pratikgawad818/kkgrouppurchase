import { PermanentDelete } from "@/components/erp/permanent-delete";
import { StaffProjectAssignments } from "@/components/erp/staff-project-assignments";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { inviteStaff, updateStaffAccess, createStaffAccount } from "@/lib/admin.functions";
import { PageHeader, Loading, Pill } from "@/components/erp/common";
import { ROLE_LABEL, type AppRole } from "@/lib/format";
import { useMe } from "@/lib/session";
import { useAvatarUrl } from "@/lib/avatar";
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
const ASSIGNABLE: Assignable[] = ["director", "senior_sales_executive", "purchase_manager", "store_manager", "accounts_manager", "accountant", "project_manager", "site_engineer", "auditor"];
type Staff = { id: string; full_name: string | null; email: string | null; phone: string | null; department: string | null; designation: string | null; is_active: boolean; avatar_url: string | null; roles: AppRole[] };

function StaffAvatar({ path, name }: { path: string | null; name: string }) {
  const url = useAvatarUrl(path);
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "U";
  return <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-primary text-xs font-semibold text-primary-foreground">{url.data ? <img src={url.data} alt="" className="h-full w-full object-cover" /> : ini}</span>;
}
const blankInvite = { username: "", password: "", email: "", fullName: "", phone: "", department: "", designation: "", role: "site_engineer" as Assignable };

function RoleSelect({ value, onChange, disabled, allowNone, id }: { value: string; onChange: (v: string) => void; disabled?: boolean; allowNone?: boolean; id?: string }) {
  return (
    <select id={id} className="mt-1.5 h-11 sm:h-9 w-full rounded-md border bg-background px-3 text-sm" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {allowNone && <option value="">No role</option>}
      {ASSIGNABLE.map((r) => <option value={r} key={r}>{ROLE_LABEL[r]}</option>)}
    </select>
  );
}

function UsersPage() {
  const me = useMe();
  const companyId = me.data?.profile.company_id;
  const permitted = !!me.data?.permissions.has("users.manage");
  const qc = useQueryClient();
  const run = useServerFn(updateStaffAccess);
  const invite = useServerFn(inviteStaff);
  const createAcct = useServerFn(createStaffAccount);
  const amSuper = !!me.data?.roles.includes("super_admin");
  const byUsername = true;
  const [staff, setStaff] = useState<Staff | null>(null);
  const [edit, setEdit] = useState({ role: "", active: true, phone: "", department: "", designation: "" });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inv, setInv] = useState(blankInvite);

  const q = useQuery({
    queryKey: ["users", companyId],
    enabled: !!companyId && permitted,
    queryFn: async () => {
      if (!companyId) throw new Error("An active company is required.");
      const { data: profiles, error: profileError } = await supabase.from("profiles")
        .select("id,full_name,email,phone,department,designation,is_active,avatar_url")
        .eq("company_id", companyId).order("full_name");
      if (profileError) throw profileError;
      if (!profiles?.length) return [] as Staff[];
      const { data: roles, error: rolesError } = await supabase.from("user_roles")
        .select("user_id,role").in("user_id", profiles.map(x => x.id));
      if (rolesError) throw rolesError;
      return profiles.map((x) => ({
        ...x, roles: (roles ?? []).filter((y) => y.user_id === x.id).map(y => y.role as AppRole),
      })) as Staff[];
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["users"] }); qc.invalidateQueries({ queryKey: ["me"] }); };

  const save = useMutation({
    mutationFn: async () => { if (staff) await run({ data: { userId: staff.id, role: (edit.role || null) as AppRole | null, active: edit.active, phone: edit.phone, department: edit.department, designation: edit.designation } }); },
    onSuccess: () => { refresh(); setStaff(null); toast.success("Staff access updated"); },
    onError: (e) => toast.error(e.message),
  });
  const create = useMutation({
    mutationFn: async () => {
      const { username, password, email, ...rest } = inv;
      if (amSuper && byUsername) await createAcct({ data: { ...rest, username, password } });
      else await invite({ data: { ...rest, email, redirectTo: window.location.origin + "/reset-password" } });
    },
    onSuccess: () => { refresh(); setInviteOpen(false); toast.success(amSuper && byUsername ? `Account created. Share username “${inv.username.trim().toLowerCase()}” and the password with the staff member.` : "Invitation sent"); setInv(blankInvite); },
    onError: (e) => toast.error(e.message),
  });

  function open(s: Staff) {
    setStaff(s);
    setEdit({ role: s.roles.find((r) => r !== "super_admin") ?? "", active: s.is_active, phone: s.phone ?? "", department: s.department ?? "", designation: s.designation ?? "" });
  }
  const isSuper = !!staff?.roles.includes("super_admin");

  if (me.isLoading) return <Loading />;
  if (me.error) return <div role="alert" className="text-sm text-destructive">Could not verify your account permissions.</div>;
  if (!permitted || !companyId) return <div role="alert" className="text-sm text-destructive">Staff administration is not available to this account.</div>;
  if (q.isLoading) return <Loading />;
  if (q.error) return <div role="alert" className="text-sm text-destructive">{q.error.message}</div>;
  return (
    <>
      <PageHeader title="Users & Permissions" subtitle="Create staff accounts, assign roles and control access" actions={<Button size="sm" onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4" />Invite staff</Button>} />
      <div className="doc-table overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Staff member</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">Department</th><th className="px-3 py-2">Designation</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Access</th><th /></tr></thead>
          <tbody>
            {q.data?.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2"><div className="flex items-center gap-3"><StaffAvatar path={u.avatar_url} name={u.full_name || u.email || ""} /><div><div className="font-medium">{u.full_name || "Unnamed staff"}</div><div className="text-xs text-muted-foreground">{u.email}</div></div></div></td>
                <td className="px-3 py-2">{u.phone || "—"}</td>
                <td className="px-3 py-2">{u.department || "—"}</td>
                <td className="px-3 py-2">{u.designation || "—"}</td>
                <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{u.roles.length ? u.roles.map((r) => <Pill key={r}>{ROLE_LABEL[r]}</Pill>) : <span className="text-muted-foreground">Awaiting role</span>}</div></td>
                <td className="px-3 py-2"><Pill>{u.is_active ? "Active" : "Inactive"}</Pill></td>
                <td className="px-3 py-2 text-right"><Button variant="ghost" size="icon" aria-label={`Edit ${u.full_name ?? u.email}`} onClick={() => open(u)}><Pencil className="h-4 w-4" /></Button><PermanentDelete kind="user" id={u.id} name={u.full_name || u.email || "staff member"} disabled={u.id===me.data?.profile.id || u.roles.includes("super_admin")}/></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!staff} onOpenChange={(open) => {
        if (!open && !save.isPending) setStaff(null);
      }}>
        <DialogContent className="flex max-h-[min(90dvh,860px)] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]">
          <DialogHeader className="shrink-0 border-b bg-muted/30 px-5 py-4 pr-14 sm:px-6 sm:py-5">
            <DialogTitle className="text-xl font-semibold tracking-tight">Edit staff access</DialogTitle>
            <DialogDescription>
              Manage account details, operational role and assigned projects.
            </DialogDescription>
            {staff && (
              <div className="flex min-w-0 items-center gap-3 pt-3">
                <StaffAvatar path={staff.avatar_url} name={staff.full_name || staff.email || "Staff member"} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {staff.full_name || "Unnamed staff"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{staff.email || "No email recorded"}</p>
                </div>
              </div>
            )}
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
            <section aria-label="Staff information">
              <div className="mb-3">
                <h3 className="text-sm font-semibold">Staff information</h3>
                <p className="text-xs text-muted-foreground">Contact details and workspace role</p>
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <Label htmlFor="staff-edit-phone">Phone</Label>
                  <Input id="staff-edit-phone" className="mt-1.5" inputMode="tel"
                    value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
                </div>
                <div className="min-w-0">
                  <Label htmlFor="staff-edit-department">Department</Label>
                  <Input id="staff-edit-department" className="mt-1.5"
                    value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value })} />
                </div>
                <div className="min-w-0">
                  <Label htmlFor="staff-edit-designation">Designation</Label>
                  <Input id="staff-edit-designation" className="mt-1.5"
                    value={edit.designation} onChange={(e) => setEdit({ ...edit, designation: e.target.value })} />
                </div>
                <div className="min-w-0">
                  <Label htmlFor="staff-edit-role">Operational role</Label>
                  <RoleSelect id="staff-edit-role" allowNone value={edit.role}
                    onChange={(v) => setEdit({ ...edit, role: v })} disabled={isSuper} />
                  {isSuper && <p className="mt-1 text-xs text-muted-foreground">
                    Super Admin role cannot be changed here.
                  </p>}
                </div>
              </div>
            </section>

            <section className="rounded-xl border bg-muted/20 p-4" aria-label="Account status">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">Active access</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Inactive staff cannot sign in to the workspace.
                  </p>
                </div>
                <Switch aria-label="Active staff access" checked={edit.active}
                  onCheckedChange={(value) => setEdit({ ...edit, active: value })}
                  disabled={isSuper} />
              </div>
            </section>

            {staff && !isSuper && (
              <StaffProjectAssignments key={staff.id} staffId={staff.id} />
            )}
          </div>

          <div className="shrink-0 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Project changes save immediately. Contact details, role and status save below.
              </p>
              <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                <Button type="button" variant="outline" disabled={save.isPending}
                  onClick={() => setStaff(null)}>Close</Button>
                <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save staff details"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{amSuper && byUsername ? "Create staff account" : "Invite staff"}</DialogTitle><DialogDescription>{amSuper && byUsername ? "Set a username and password. To reset a password later, staff first add their email in My profile." : "They'll receive an email to set their password."}</DialogDescription></DialogHeader>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <div className="sm:col-span-2"><Label>Full name</Label><Input required value={inv.fullName} onChange={(e) => setInv({ ...inv, fullName: e.target.value })} /></div>
            {amSuper && byUsername ? (<>
              <div><Label>Username</Label><Input required autoComplete="off" pattern="[A-Za-z0-9._\-]{3,32}" title="3–32 letters, numbers, dot, dash or underscore" value={inv.username} onChange={(e) => setInv({ ...inv, username: e.target.value })} /></div>
              <div><Label>Password</Label><Input type="text" required minLength={8} autoComplete="new-password" value={inv.password} onChange={(e) => setInv({ ...inv, password: e.target.value })} /></div>
            </>) : (
              <div className="sm:col-span-2"><Label>Email</Label><Input type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></div>
            )}
            <div className="sm:col-span-2"><Label>Role</Label><RoleSelect value={inv.role} onChange={(v) => setInv({ ...inv, role: v as Assignable })} /></div>
            <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving…" : amSuper && byUsername ? "Create account" : "Send invitation"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
