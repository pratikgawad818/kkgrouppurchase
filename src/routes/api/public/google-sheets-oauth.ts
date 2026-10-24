import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/google-sheets-oauth")({
  server: { handlers: {
    GET: async ({ request }) => {
      const parsed = new URL(request.url);
      const target = new URL("/settings/google-sheets", parsed.origin);
      const state = parsed.searchParams.get("state") ?? "";
      const code = parsed.searchParams.get("code") ?? "";
      if (parsed.searchParams.has("error") || !state || !code) {
        target.searchParams.set("google", "denied");
        return Response.redirect(target, 303);
      }
      try {
        const { finishGoogleOAuth } = await import("@/lib/google-oauth.server");
        await finishGoogleOAuth(state, code);
        target.searchParams.set("google", "connected");
      } catch (err) {
        console.error("Google OAuth callback:", err instanceof Error ? err.message : "unknown error");
        target.searchParams.set("google", "failed");
      }
      return Response.redirect(target, 303);
    },
  }},
});
