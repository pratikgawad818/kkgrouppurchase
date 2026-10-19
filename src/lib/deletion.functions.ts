import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validatePermanentDeletion } from "@/lib/deletion-policy";

export const permanentlyDeleteRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ kind:z.enum(["material","purchase_request","rfq","user"]), id:z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const [role, actor] = await Promise.all([
      context.supabase.rpc("has_role",{_user_id:context.userId,_role:"super_admin"}),
      context.supabase.from("profiles").select("company_id,is_active").eq("id",context.userId).single(),
    ]);
    if (role.error || !role.data || actor.error || !actor.data?.is_active) throw new Error("Only an active Super Admin can permanently delete records.");
    const { error: checkError } = await context.supabase.rpc("super_admin_delete_record",{_kind:data.kind,_id:data.id,_check_only:true});
    if(checkError) throw new Error(checkError.message);
    if(data.kind === "user") {
      const [target, targetRole] = await Promise.all([
        context.supabase.from("profiles").select("company_id").eq("id",data.id).single(),
        context.supabase.rpc("has_role",{_user_id:data.id,_role:"super_admin"}),
      ]);
      if(target.error || targetRole.error) throw new Error("Staff account could not be verified.");
      validatePermanentDeletion({kind:data.kind,isSuperAdmin:role.data,active:actor.data.is_active,actorCompanyId:actor.data.company_id,targetCompanyId:target.data.company_id,actorId:context.userId,targetId:data.id,targetIsSuperAdmin:targetRole.data});
      const { error: historyError } = await context.supabase.rpc("check_staff_deletion_history", {_id:data.id});
      if(historyError) throw new Error(historyError.message);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.auth.admin.deleteUser(data.id);
      if(error && error.code !== "user_not_found") throw new Error("Staff sign-in account could not be deleted. No profile was removed.");
      const { error: finalizeError } = await supabaseAdmin.rpc("finalize_staff_permanent_delete", {_actor_id:context.userId,_id:data.id});
      if(finalizeError) throw new Error("Sign-in access was removed, but the staff profile could not be deleted. Retry deletion; linked history remains protected.");
      return { ok:true };
    }
    const { error } = await context.supabase.rpc("super_admin_delete_record",{_kind:data.kind,_id:data.id});
    if(error) throw new Error(error.message);
    return { ok:true };
  });