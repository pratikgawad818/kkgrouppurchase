import { createFileRoute } from "@tanstack/react-router";
import { buildPushHTTPRequest } from "@pushforge/builder";
import {
  allowedPushEndpoint,
  internalNotificationLink,
  matchingDispatchSecret,
} from "@/lib/push-security";

// Called by the database (pg_net) after a notification row is inserted.
// Verifies the shared dispatch secret before sending any phone alert.
export const Route = createFileRoute("/api/public/push-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: cfg } = await supabaseAdmin
          .from("push_config")
          .select("*")
          .eq("id", 1)
          .maybeSingle();
        const given = request.headers.get("x-dispatch-secret") ?? "";
        if (!cfg || !matchingDispatchSecret(given, cfg.dispatch_secret))
          return new Response("Forbidden", { status: 403 });
        if (Number(request.headers.get("content-length") ?? 0) > 256)
          return new Response("Too large", { status: 413 });

        const reader = request.body?.getReader();
        let raw = "";
        let bytes = 0;
        if (reader) {
          const decoder = new TextDecoder();
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 256) {
              await reader.cancel();
              return new Response("Too large", { status: 413 });
            }
            raw += decoder.decode(chunk.value, { stream: true });
          }
          raw += decoder.decode();
        }
        let body: { id?: unknown } | null = null;
        try {
          body = JSON.parse(raw);
        } catch {
          /* invalid body */
        }
        if (
          typeof body?.id !== "string" ||
          !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.id)
        )
          return new Response("Bad request", { status: 400 });

        const { data: n, error: notificationError } = await supabaseAdmin
          .from("notifications")
          .select("id,user_id,title,body,link")
          .eq("id", body.id)
          .maybeSingle();
        if (notificationError) return new Response("Unavailable", { status: 503 });
        if (!n) return new Response("Not found", { status: 404 });
        const { data: actor, error: actorError } = await supabaseAdmin
          .from("profiles")
          .select("is_active")
          .eq("id", n.user_id)
          .maybeSingle();
        if (actorError) return new Response("Unavailable", { status: 503 });
        if (!actor?.is_active) return Response.json({ sent: 0 });
        const { data: subs, error: subsError } = await supabaseAdmin
          .from("push_subscriptions")
          .select("*")
          .eq("user_id", n.user_id)
          .order("created_at", { ascending: false })
          .limit(10);
        const { count, error: countError } = await supabaseAdmin
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", n.user_id)
          .eq("is_read", false);
        if (subsError || countError) return new Response("Unavailable", { status: 503 });

        let sent = 0;
        let failed = 0;
        for (const s of subs ?? []) {
          if (!allowedPushEndpoint(s.endpoint)) {
            failed++;
            continue;
          }
          try {
            const req = await buildPushHTTPRequest({
              privateJWK: cfg.vapid_private_jwk as JsonWebKey,
              subscription: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              message: {
                payload: {
                  title: n.title.slice(0, 150),
                  body: (n.body ?? "").slice(0, 1000),
                  link: internalNotificationLink(n.link),
                  badge: count ?? 0,
                  tag: n.id,
                },
                adminContact: "mailto:admin@kkgroups.in",
                options: { ttl: 86400, urgency: "high" },
              },
            });
            // Provider redirects must never turn an approved destination into an arbitrary request.
            const res = await fetch(req.endpoint, {
              method: "POST",
              headers: req.headers,
              body: req.body,
              redirect: "error",
              signal: AbortSignal.timeout(5000),
            });
            if (res.status === 404 || res.status === 410) {
              await supabaseAdmin.from("push_subscriptions").delete().eq("id", s.id);
            } else if (!res.ok) {
              failed++;
              console.error(`Push delivery failed with status ${res.status}`);
            } else sent++;
            await res.body?.cancel();
          } catch {
            failed++;
            console.error("Push delivery failed");
          }
        }
        return Response.json({ sent, failed }, { status: failed ? 502 : 200 });
      },
    },
  },
});
