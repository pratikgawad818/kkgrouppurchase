import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";

const db = supabaseAdmin as unknown as SupabaseClient;
const SCOPE = "https://www.googleapis.com/auth/spreadsheets openid email";
type OAuthConfig = { clientId: string; secret: string; redirectUri: string; key: Buffer };
function config(): OAuthConfig {
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"] ?? "";
  const secret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ?? "";
  const redirectUri = process.env["GOOGLE_OAUTH_REDIRECT_URI"] ?? "";
  const keyHex = process.env["GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY"] ?? "";
  if (!clientId || !secret || !redirectUri || !/^[0-9a-fA-F]{64}$/.test(keyHex))
    throw new Error("Google OAuth deployment setup required. Configure Google OAuth client, redirect URI and encryption key.");
  const url = new URL(redirectUri);
  if (url.protocol !== "https:" || url.pathname !== "/api/public/google-sheets-oauth")
    throw new Error("Google OAuth redirect URI must use HTTPS and /api/public/google-sheets-oauth.");
  return { clientId, secret, redirectUri, key: Buffer.from(keyHex, "hex") };
}
export function googleOAuthConfigured(): boolean {
  try { config(); return true; } catch { return false; }
}
const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
function encrypt(value:string, key:Buffer) {
  const iv=randomBytes(12), cipher=createCipheriv("aes-256-gcm",key,iv);
  const ciphertext=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return [iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),ciphertext.toString("base64url")].join(".");
}
function decrypt(value:string, key:Buffer) {
  const parts=value.split(".");
  if(parts.length!==3)throw new Error("Invalid stored Google authorization.");
  const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(parts[0]!,"base64url"));
  decipher.setAuthTag(Buffer.from(parts[1]!,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[2]!,"base64url")),decipher.final()]).toString("utf8");
}
export async function beginGoogleOAuth(companyId:string, actorId:string, spreadsheetId:string) {
  const c=config();
  const state=randomBytes(32).toString("base64url");
  const {error}=await db.from("erp_google_oauth_states").insert({
    state_hash:digest(state),company_id:companyId,actor_id:actorId,spreadsheet_id:spreadsheetId,
    expires_at:new Date(Date.now()+10*60_000).toISOString(),
  });
  if(error)throw new Error("Could not start Google authorization: "+error.message);
  const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id",c.clientId);
  url.searchParams.set("redirect_uri",c.redirectUri);
  url.searchParams.set("response_type","code");
  url.searchParams.set("scope",SCOPE);
  url.searchParams.set("access_type","offline");
  url.searchParams.set("prompt","consent select_account");
  url.searchParams.set("state",state);
  return {authorizationUrl:url.toString()};
}
async function tokenRequest(form:URLSearchParams):Promise<{access_token:string;refresh_token?:string;expires_in?:number}> {
  const r=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form,
    signal:AbortSignal.timeout(20000),
  });
  if(!r.ok)throw new Error("Google token exchange failed ("+r.status+").");
  const data=await r.json() as {access_token?:string;refresh_token?:string;expires_in?:number};
  if(!data.access_token)throw new Error("Google did not provide an access token.");
  return {...data,access_token:data.access_token};
}
const tokenCache=new Map<string,{token:string;expires:number}>();
export async function googleAccessToken(companyId:string):Promise<string> {
  const cached=tokenCache.get(companyId);
  if(cached&&cached.expires>Date.now()+90_000)return cached.token;
  const {data,error}=await db.from("erp_google_sheet_connections")
    .select("oauth_refresh_token_ciphertext").eq("company_id",companyId).maybeSingle();
  if(error)throw new Error(error.message);
  if(!data?.oauth_refresh_token_ciphertext)throw new Error("Connect a Google account in ERP Settings first.");
  const c=config();
  const refresh=decrypt(String(data.oauth_refresh_token_ciphertext),c.key);
  const form=new URLSearchParams({client_id:c.clientId,client_secret:c.secret,
    refresh_token:refresh,grant_type:"refresh_token"});
  const result=await tokenRequest(form);
  tokenCache.set(companyId,{token:result.access_token,
    expires:Date.now()+Math.min(result.expires_in??3500,3500)*1000});
  return result.access_token;
}
export async function finishGoogleOAuth(state:string, code:string) {
  const c=config();
  if(!/^[A-Za-z0-9_-]{30,100}$/.test(state) || !code||code.length>4096)
    throw new Error("Invalid Google authorization response.");
  // A state is consumed once, even if a subsequent Google request fails.
  const {data:pending,error:consumeError}=await db.from("erp_google_oauth_states")
    .delete().eq("state_hash",digest(state))
    .gt("expires_at",new Date().toISOString())
    .select("company_id,actor_id,spreadsheet_id").maybeSingle();
  if(consumeError||!pending)throw new Error("Google sign-in expired or was already used. Start again.");
  const {data:admin,error:adminError}=await db.from("profiles")
    .select("is_active,company_id").eq("id",pending.actor_id).single();
  const {data:hasRole,error:roleError}=await db.rpc("has_role",{
    _user_id:pending.actor_id,_role:"super_admin",
  });
  if(adminError||roleError||!admin?.is_active||admin.company_id!==pending.company_id||!hasRole)
    throw new Error("The initiating Super Admin is no longer authorized.");
  const result=await tokenRequest(new URLSearchParams({
    client_id:c.clientId,client_secret:c.secret,redirect_uri:c.redirectUri,
    grant_type:"authorization_code",code,
  }));
  if(!result.refresh_token)throw new Error("Google did not provide offline access. Revoke app permission and reconnect.");
  const [sheetResponse,userResponse]=await Promise.all([
    fetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(pending.spreadsheet_id)+"?fields=spreadsheetId,properties.title",{
      headers:{authorization:"Bearer "+result.access_token},signal:AbortSignal.timeout(20000),
    }),
    fetch("https://openidconnect.googleapis.com/v1/userinfo",{
      headers:{authorization:"Bearer "+result.access_token},signal:AbortSignal.timeout(20000),
    }),
  ]);
  if(!sheetResponse.ok)throw new Error("Google account cannot access this spreadsheet. Open it with the selected account and retry.");
  if(!userResponse.ok)throw new Error("Google account verification failed.");
  const sheet=await sheetResponse.json() as {spreadsheetId?:string;properties?:{title?:string}};
  const profile=await userResponse.json() as {email?:string;email_verified?:boolean};
  if(sheet.spreadsheetId!==pending.spreadsheet_id||!profile.email||profile.email_verified!==true)
    throw new Error("Google returned an invalid spreadsheet or account.");
  const {error}=await db.from("erp_google_sheet_connections").upsert({
    company_id:pending.company_id,spreadsheet_id:pending.spreadsheet_id,
    spreadsheet_title:sheet.properties?.title??"",enabled:true,configured_by:pending.actor_id,
    oauth_refresh_token_ciphertext:encrypt(result.refresh_token,c.key),oauth_account_email:profile.email,
    last_error:null,last_synced_at:null,last_result:null,updated_at:new Date().toISOString(),
  },{onConflict:"company_id"});
  if(error)throw new Error("Failed to save Google connection: "+error.message);
  tokenCache.delete(pending.company_id);
  return {email:profile.email,title:sheet.properties?.title??""};
}
