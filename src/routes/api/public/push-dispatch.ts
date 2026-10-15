import { createFileRoute } from "@tanstack/react-router";
import { buildPushHTTPRequest } from "@pushforge/builder";

// Called by the database (pg_net) after a notification row is inserted.
// Verifies the shared dispatch secret before sending any phone alert.
export const Route = createFileRoute("/api/public/push-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: cfg } = await supabaseAdmin.from("push_config").select("*").eq("id", 1).maybeSingle();
        const given = request.headers.get("x-dispatch-secret") ?? "";
        if (!cfg || !given || given !== cfg.dispatch_secret) return new Response("Forbidden", { status: 403 });

        const body = (await request.json().catch(() => null)) as { id?: string } | null;
        if (!body?.id || !/^[0-9a-f-]{36}$/i.test(body.id)) return new Response("Bad request", { status: 400 });

        const { data: n } = await supabaseAdmin.from("notifications").select("id,user_id,title,body,link").eq("id", body.id).maybeSingle();
        if (!n) return new Response("Not found", { status: 404 });
        const { data: subs } = await supabaseAdmin.from("push_subscriptions").select("*").eq("user_id", n.user_id);
        const { count } = await supabaseAdmin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", n.user_id).eq("is_read", false);

        let sent = 0;
        for (const s of subs ?? []) {
          try {
            const req = await buildPushHTTPRequest({
              privateJWK: cfg.vapid_private_jwk as JsonWebKey,
              subscription: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              message: {
                payload: { title: n.title, body: n.body ?? "", link: n.link ?? "/dashboard", badge: count ?? 0, tag: n.id },
                adminContact: "mailto:admin@kkgroups.in",
                options: { ttl: 86400, urgency: "high" },
              },
            });
            const res = await fetch(req.endpoint, { method: "POST", headers: req.headers, body: req.body });
            if (res.status === 404 || res.status === 410) {
              await supabaseAdmin.from("push_subscriptions").delete().eq("id", s.id);
            } else if (!res.ok) {
              console.error(`Push failed [${res.status}]: ${await res.text()}`);
            } else sent++;
          } catch (e) {
            console.error("Push build/send error", e);
          }
        }
        return Response.json({ sent });
      },
    },
  },
});
