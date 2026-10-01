import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roleSchema = z.enum(["super_admin", "director", "purchase_manager", "store_manager", "accounts_manager", "accountant", "project_manager", "site_engineer", "auditor"]);

export const updateStaffAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid(), role: roleSchema.nullable(), active: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: allowed, error: permissionError } = await context.supabase.rpc("has_permission", { _user_id: context.userId, _code: "users.manage" });
    if (permissionError || !allowed) throw new Error("You do not have permission to manage staff access.");
    if (data.userId === context.userId && !data.active) throw new Error("You cannot deactivate your own account.");
    const { data: targetRoles, error: readError } = await context.supabase.from("user_roles").select("role").eq("user_id", data.userId);
    if (readError) throw readError;
    if (targetRoles.some((item) => item.role === "super_admin") && data.userId !== context.userId) {
      const { data: isSuper } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "super_admin" });
      if (!isSuper) throw new Error("Only a Super Admin can change another Super Admin.");
    }
    const { error: profileError } = await context.supabase.from("profiles").update({ is_active: data.active }).eq("id", data.userId);
    if (profileError) throw profileError;
    const { error: deleteError } = await context.supabase.from("user_roles").delete().eq("user_id", data.userId);
    if (deleteError) throw deleteError;
    if (data.role) {
      const { error: insertError } = await context.supabase.from("user_roles").insert({ user_id: data.userId, role: data.role });
      if (insertError) throw insertError;
    }
    return { ok: true };
  });