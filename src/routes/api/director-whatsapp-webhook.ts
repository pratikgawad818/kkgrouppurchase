import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { handleDirectorWebhook } from "@/lib/director-whatsapp-webhook";

async function handle(request: Request) {
  return handleDirectorWebhook(request, process.env, async receipts => {
    const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("Receipt service unavailable");
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await db.rpc("wa_director_record_receipts", { _receipts: receipts });
    if (result.error) throw new Error("Receipt storage unavailable");
  });
}

export const Route = createFileRoute("/api/director-whatsapp-webhook")({
  server: { handlers: {
    GET: ({ request }) => handle(request),
    POST: ({ request }) => handle(request),
  } },
});
