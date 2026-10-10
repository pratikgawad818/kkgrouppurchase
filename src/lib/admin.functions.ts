import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateStaffUpdate } from "@/lib/staff-access";

const roleSchema = z.enum(["super_admin", "director", "purchase_manager", "store_manager", "accounts_manager", "accountant", "project_manager", "site_engineer", "auditor"]);

const assignable = roleSchema.exclude(["super_admin"]);

export const inviteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    email: z.string().trim().email().max(255),
    fullName: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(20).optional().default(""),
    department: z.string().trim().max(80).optional().default(""),
    designation: z.string().trim().max(80).optional().default(""),
    role: assignable,
    redirectTo: z.string().url(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: allowed, error: permissionError } = await context.supabase.rpc("has_permission", { _user_id: context.userId, _code: "users.manage" });
    if (permissionError || !allowed) throw new Error("You do not have permission to create staff.");
    const { data: me, error: profileError } = await context.supabase.from("profiles").select("company_id,is_active").eq("id", context.userId).single();
    if (profileError || !me?.is_active || !me.company_id) throw new Error("Your account needs an active company before inviting staff.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invited, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, { redirectTo: data.redirectTo, data: { full_name: data.fullName } });
    if (error) throw new Error(error.message);
    const id = invited.user.id;
    const { error: pErr } = await supabaseAdmin.from("profiles").upsert({ id, email: data.email, full_name: data.fullName, phone: data.phone || null, department: data.department || null, designation: data.designation || null, company_id: me.company_id, is_active: true });
    if (pErr) throw new Error(pErr.message);
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert({ user_id: id, role: data.role });
    if (rErr) throw new Error(rErr.message);
    return { ok: true };
  });

export const updateStaffAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid(), role: roleSchema.nullable(), active: z.boolean(), phone: z.string().trim().max(20).optional(), department: z.string().trim().max(80).optional(), designation: z.string().trim().max(80).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: allowed, error: permissionError } = await context.supabase.rpc("has_permission", { _user_id: context.userId, _code: "users.manage" });
    if (permissionError || !allowed) throw new Error("You do not have permission to manage staff access.");
    const [actor, target, existing, superResult] = await Promise.all([
      context.supabase.from("profiles").select("company_id,is_active").eq("id", context.userId).single(),
      context.supabase.from("profiles").select("id,company_id").eq("id", data.userId).single(),
      context.supabase.from("user_roles").select("role").eq("user_id", data.userId),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "super_admin" }),
    ]);
    if (actor.error || !actor.data?.is_active || !actor.data.company_id) throw new Error("Your account has no active company.");
    if (target.error || !target.data || existing.error || superResult.error) {
      throw new Error("Staff account or role assignments could not be verified.");
    }
    const decision = validateStaffUpdate({
      actorId: context.userId,
      actorCompanyId: actor.data.company_id,
      targetId: target.data.id,
      targetCompanyId: target.data.company_id,
      actorIsSuperAdmin: !!superResult.data,
      existingRoles: existing.data.map(item => item.role),
      requestedRole: data.role,
      requestedActive: data.active,
    });
    const { data: changed, error: profileError } = await context.supabase.from("profiles")
      .update({ is_active: data.active, ...(data.phone !== undefined && { phone: data.phone || null }), ...(data.department !== undefined && { department: data.department || null }), ...(data.designation !== undefined && { designation: data.designation || null }) })
      .eq("id", data.userId).eq("company_id", actor.data.company_id).select("id").single();
    if (profileError || !changed) throw new Error("Staff details could not be updated in your company.");
    if (decision.changeRoles && !decision.preserveSuperAdmin) {
      const { error: deleteError } = await context.supabase.from("user_roles").delete().eq("user_id", data.userId);
      if (deleteError) throw deleteError;
      if (data.role) {
        const { error: insertError } = await context.supabase.from("user_roles").insert({ user_id: data.userId, role: data.role });
        if (insertError) throw insertError;
      }
    }
    return { ok: true };
  });