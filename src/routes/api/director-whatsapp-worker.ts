import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { directorWaConfig, deliverDirectorTemplate, type DirectorNotice } from "@/lib/director-whatsapp-delivery";

/**
 * Private scheduled POST endpoint. Requires non-browser X-KK-Director-Worker
 * secret; Supabase service key never goes to clients. No GET handler.
 */
export const Route = createFileRoute("/api/director-whatsapp-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["KK_DIRECTOR_WA_WORKER_SECRET"] ?? "";
        const provided = request.headers.get("x-kk-director-worker-secret") ?? "";
        const a = Buffer.from(expected), b = Buffer.from(provided);
        if (a.length < 32 || b.length !== a.length || !timingSafeEqual(a,b)) {
          return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
        }
        const config = directorWaConfig(process.env);
        const url = process.env["SUPABASE_URL"];
        const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
        if (!config.ready || !url || !key) {
          return Response.json({ enabled: false, message: "Verified sender and service credentials required" },
            { status: 503, headers: { "Cache-Control": "no-store" } });
        }
        const db = createClient(url,key,{ auth: { persistSession:false, autoRefreshToken:false } });
        const reminders = await db.rpc("wa_director_queue_reminders");
        if (reminders.error) return Response.json({ error: "Reminder queue unavailable" },{status:503});
        const claims = await db.rpc("wa_director_claim_batch",{ _max:3 });
        if (claims.error) return Response.json({ error: "Director alert queue unavailable" },{status:503});
        let accepted=0, uncertain=0, rejected=0, skipped=0;
        for (const item of (claims.data ?? []) as DirectorNotice[]) {
          const eligibility = await db.rpc("wa_director_claim_valid",{_id:item.outbox_id,_claim:item.lease_id});
          let result: {status:"accepted"|"rejected"|"unknown"|"skipped";messageId:string|null;errorCode:string};
          if (eligibility.error || !eligibility.data) {
            result = {status:"skipped",messageId:null,errorCode:"no_longer_eligible"};
          } else {
            result = await deliverDirectorTemplate(config,item);
          }
          const finished = await db.rpc("wa_director_finish_claim",{
            _id:item.outbox_id,_lease:item.lease_id,_status:result.status,
            _wamid:result.messageId,_error:result.errorCode,
          });
          // Never resend when the API may have accepted a request but DB write
          // failed. Lease expiry marks the record unknown for manual review.
          if (finished.error || finished.data !== true) {
            return Response.json({ error: "Alert audit write unavailable; do not retry this run" },
              {status:503,headers:{"Cache-Control":"no-store"}});
          }
          if (result.status==="accepted") accepted++;
          if (result.status==="rejected") rejected++;
          if (result.status==="unknown") uncertain++;
          if (result.status==="skipped") skipped++;
        }
        return Response.json({ claimed:(claims.data ?? []).length,accepted,rejected,unknown:uncertain,skipped },
          {headers:{"Cache-Control":"no-store"}});
      },
    },
  },
});
