import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SANDBOX, getTestConfig, sendHelloWorld } from "@/lib/whatsapp-sandbox";

/** Both GET and POST separately verify current, active, company-linked super_admin. */
export const getWhatsAppTestStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [profile, role] = await Promise.all([
      context.supabase.from("profiles").select("company_id,is_active").eq("id", context.userId).single(),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "super_admin" }),
    ]);
    if (profile.error || !profile.data?.company_id || !profile.data.is_active || role.error || !role.data)
      throw new Error("Only an active ERP super administrator can access WhatsApp testing.");
    const config = getTestConfig(process.env);
    return { ready: config.ready, missing: config.missing, recipient: config.maskedRecipient,
      sender: SANDBOX.displayNumber };
  });

export const sendWhatsAppTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value) => z.object({ confirm: z.literal(true) }).strict().parse(value))
  .handler(async ({ data, context }) => {
    if (data.confirm !== true) throw new Error("Explicit confirmation required.");
    const [profile, role] = await Promise.all([
      context.supabase.from("profiles").select("company_id,is_active").eq("id", context.userId).single(),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "super_admin" }),
    ]);
    if (profile.error || !profile.data?.company_id || !profile.data.is_active || role.error || !role.data)
      throw new Error("Only an active ERP super administrator can send WhatsApp tests.");
    const messageId = await sendHelloWorld(getTestConfig(process.env));
    // Audit of accepted request only. No secrets, phone numbers, or message bodies.
    console.info("[WhatsApp sandbox] Meta accepted", { actor: context.userId, messageId });
    return { accepted: true, messageId };
  });
