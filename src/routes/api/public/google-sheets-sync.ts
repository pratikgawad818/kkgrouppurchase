import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

function authorized(presented:string) {
  const secret=process.env["GOOGLE_SHEETS_SYNC_SECRET"]??"";
  if(secret.length<32 || presented.length!==secret.length) return false;
  return timingSafeEqual(Buffer.from(presented),Buffer.from(secret));
}
// Invoked by a protected external scheduler (GitHub Actions or equivalent).
// This handler processes one company per request to limit serverless execution time.
export const Route=createFileRoute("/api/public/google-sheets-sync")({
  server:{handlers:{
    POST:async({request})=>{
      if(!authorized(request.headers.get("x-erp-sheets-secret")??""))
        return new Response("Forbidden",{status:403});
      try {
        const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
        const db=supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
        const {data,error}=await db.from("erp_google_sheet_connections")
          .select("company_id").eq("enabled",true)
          .order("last_synced_at",{ascending:true,nullsFirst:true}).limit(10);
        if(error) throw error;
        const {syncGoogleSheet}=await import("@/lib/google-sheets.server");
        for (const connection of data??[]) {
          const outcome=await syncGoogleSheet(String(connection.company_id));
          if(!("busy" in outcome)) return Response.json({ok:true,processed:1});
        }
        return Response.json({ok:true,processed:0});
      } catch(err) {
        console.error("Google Sheets sync failed:",err instanceof Error?err.message:"unknown");
        return Response.json({ok:false,error:"Sync failed. See ERP connection status."},{status:503});
      }
    }
  }}
});
