import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** A self-test never sends to another user's device or creates a business record. */
export const testMyPhoneAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ endpoint: z.string().url().max(4096) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: profile, error } = await context.supabase
      .from("profiles")
      .select("is_active")
      .eq("id", context.userId)
      .single();
    if (error || !profile?.is_active) throw new Error("Your staff account must be active.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // One atomic reservation per device: repeated taps cannot flood a phone.
    const { data: sub, error: claimError } = await supabaseAdmin
      .from("push_subscriptions")
      .update({ last_test_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("endpoint", data.endpoint)
      .or(`last_test_at.is.null,last_test_at.lt.${new Date(Date.now() - 30_000).toISOString()}`)
      .select("id,endpoint,p256dh,auth")
      .maybeSingle();
    if (claimError) throw new Error("Phone alert check is unavailable. Please try again.");
    if (!sub)
      throw new Error("Enable alerts on this device, or wait 30 seconds before testing again.");
    const { data: cfg } = await supabaseAdmin
      .from("push_config")
      .select("vapid_private_jwk")
      .eq("id", 1)
      .single();
    if (!cfg) throw new Error("Phone alert delivery has not been configured.");
    const { deliverPush } = await import("@/lib/push-delivery.server");
    const result = await deliverPush(cfg.vapid_private_jwk, sub, {
      title: "KK GROUP ERP · Test notification",
      body: "Phone alerts are working. Tap to open your workspace.",
      link: "/dashboard",
      tag: `phone-test-${sub.id}`,
    });
    if (result === "expired")
      throw new Error("This device registration expired. Tap Repair alerts, then test again.");
    if (result !== "sent")
      throw new Error("The push provider could not accept the alert. Please try again.");
    return { accepted: true };
  });
