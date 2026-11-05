import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { canAccessPage } from "../../src/lib/page-access.ts";
import { WORKSPACE_NAV } from "../../src/lib/workspace-navigation.ts";

const root=fileURLToPath(new URL("../../",import.meta.url));
const source=(p)=>readFileSync(join(root,p),"utf8");
test("retired Google pages, OAuth callback and sync endpoint no longer exist",()=>{
 for(const path of [
   "src/routes/_authenticated/_shell/settings.google-sheets.tsx",
   "src/routes/api/public/google-sheets-oauth.ts",
   "src/routes/api/public/google-sheets-sync.ts",
   "src/lib/google-oauth.server.ts",
   "src/lib/google-sheets.server.ts",
   "src/lib/google-sheets.functions.ts",
   ".github/workflows/google-sheets-sync.yml",
 ]){
   assert.equal(existsSync(join(root,path)),false,path);
 }
 for(const address of ["/settings/google-sheets","/api/public/google-sheets-oauth","/api/public/google-sheets-sync"]){
   assert.equal(source("src/routeTree.gen.ts").includes(address),false,address);
 }
});
test("no role can navigate to retired integration",()=>{
 const paths=WORKSPACE_NAV.flatMap(group=>group.items.map(item=>item.to));
 assert.ok(!paths.some(path=>/google.*sheet|sheet.*sync|oauth/i.test(path)));
 for(const role of ["super_admin","director","accounts_manager","accountant","purchase_manager","site_engineer","auditor"]){
   assert.equal(canAccessPage("/settings/google-sheets",{
     roles:[role], permissions:new Set(["company.manage","users.manage","tax.configure"]),
   }),false,role);
 }
});
test("migration retires OAuth credentials and schedules but retains accounting archives",()=>{
 const sql=source("drizzle/migrations/0066_retire_google_sheets_integration.sql");
 assert.match(sql,/DROP TABLE IF EXISTS public\.erp_google_oauth_states/);
 assert.match(sql,/DROP TABLE IF EXISTS public\.erp_google_sheet_connections/);
 assert.match(sql,/DROP TABLE IF EXISTS public\.erp_sheet_sync_nonces/);
 assert.match(sql,/cron\.unschedule/);
 assert.match(sql,/erp_sheet_import_documents/);
 assert.doesNotMatch(sql,/DROP TABLE [^;]*erp_project_cost_entries/i);
 assert.doesNotMatch(sql,/DROP TABLE [^;]*erp_historical_material_consumptions/i);
});
