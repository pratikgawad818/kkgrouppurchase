import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseSpreadsheetId } from "@/lib/google-sheets-model";

async function requireSheetAdmin(context: {
  userId: string;
  supabase: import("@supabase/supabase-js").SupabaseClient;
}): Promise<string> {
  const [role,profile]=await Promise.all([
    context.supabase.rpc("has_role",{_user_id:context.userId,_role:"super_admin"}),
    context.supabase.from("profiles").select("company_id,is_active").eq("id",context.userId).single(),
  ]);
  if(role.error || !role.data || profile.error || !profile.data?.company_id || !profile.data.is_active)
    throw new Error("Only an active company Super Admin may manage Google Sheets.");
  return profile.data.company_id;
}

export const getGoogleSheetsConnection = createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .handler(async ({context})=>{
    const companyId=await requireSheetAdmin(context);
    const {googleSheetStatus}=await import("@/lib/google-sheets.server");
    return googleSheetStatus(companyId);
  });

export const connectGoogleSheets = createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input)=>z.object({url:z.string().trim().min(40).max(1000)}).parse(input))
  .handler(async ({context,data})=>{
    const companyId=await requireSheetAdmin(context);
    const spreadsheetId=parseSpreadsheetId(data.url);
    const {beginGoogleOAuth}=await import("@/lib/google-oauth.server");
    return beginGoogleOAuth(companyId,context.userId,spreadsheetId);
  });

export const pasteSpreadsheetEntries = createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input)=>z.object({
    kind:z.enum(["costing","challan","invoice","historical"]),
    clipboard:z.string().min(1).max(200000),
  }).parse(input))
  .handler(async ({context,data})=>{
    const companyId=await requireSheetAdmin(context);
    const {stagePastedEntries}=await import("@/lib/google-sheet-imports.server");
    return stagePastedEntries(companyId,data.kind,data.clipboard);
  });

export const getGoogleSheetImports = createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .handler(async ({context})=>{
    const companyId=await requireSheetAdmin(context);
    const {listSheetImports}=await import("@/lib/google-sheet-imports.server");
    return listSheetImports(companyId);
  });

export const applyGoogleSheetImport = createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input)=>z.object({id:z.string().uuid()}).parse(input))
  .handler(async ({context,data})=>{
    const companyId=await requireSheetAdmin(context);
    const {applySheetEntry}=await import("@/lib/google-sheet-imports.server");
    return applySheetEntry(companyId,context.userId,context.supabase,data.id);
  });

export const setGoogleSheetsEnabled = createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input)=>z.object({enabled:z.boolean()}).parse(input))
  .handler(async ({context,data})=>{
    const companyId=await requireSheetAdmin(context);
    const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
    const db=supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const {data:changed,error}=await db.from("erp_google_sheet_connections")
      .update({enabled:data.enabled,updated_at:new Date().toISOString()})
      .eq("company_id",companyId).select("company_id").maybeSingle();
    if(error || !changed) throw new Error("Google Sheets connection was not found.");
    return {ok:true};
  });

export const syncGoogleSheetsNow = createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .handler(async ({context})=>{
    const companyId=await requireSheetAdmin(context);
    const {syncGoogleSheet}=await import("@/lib/google-sheets.server");
    return syncGoogleSheet(companyId);
  });
