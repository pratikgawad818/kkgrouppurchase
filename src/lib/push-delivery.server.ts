import { buildPushHTTPRequest } from "@pushforge/builder";
import { allowedPushEndpoint } from "@/lib/push-security";
import { sendPushRequest } from "@/lib/push-transport";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

export async function deliverPush(
  signingKey: Json,
  sub: { id: string; endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; link: string; tag: string; badge?: number },
): Promise<"sent" | "expired" | "failed"> {
  if (!allowedPushEndpoint(sub.endpoint)) return "failed";
  try {
    const request = await buildPushHTTPRequest({
      privateJWK: signingKey as JsonWebKey,
      subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      message: {
        payload,
        adminContact: "mailto:admin@kkgroups.in",
        options: { ttl: 86400, urgency: "high" },
      },
    });
    const res = await sendPushRequest(request);
    await res.body?.cancel();
    if (res.status === 404 || res.status === 410) {
      await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
      return "expired";
    }
    if (res.ok) return "sent";
    console.error(`Push provider rejected delivery: ${res.status}`);
  } catch {
    console.error("Push delivery failed");
  }
  return "failed";
}
