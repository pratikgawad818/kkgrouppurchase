import { createHash } from "node:crypto";
import { googleAccessToken, googleOAuthConfigured } from "@/lib/google-oauth.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  HISTORICAL_HEADERS, HISTORICAL_TAB, EXPORT_TABS,
  parseHistoricalRow, canonicalHistorical, decideHistoricalConflict,
  type HistoricalInput,
} from "@/lib/google-sheets-model";

const db = supabaseAdmin as unknown as SupabaseClient;
type Connection = {
  company_id: string; spreadsheet_id: string; spreadsheet_title: string;
  enabled: boolean; last_synced_at: string | null; last_error: string | null;
  last_result: { imported?:number;exported?:number;errors?:number;conflicts?:string[];exports?:Record<string,string>;at?:string } | null;
  sync_lease_until: string | null;
};
type Master = { id: string; code: string; name?: string; project_id?: string };
type History = {
  id: string; reference: string; occurred_on: string;
  project_id: string; building_id: string | null; material_id: string;
  quantity: number; unit_cost: number; purpose: string; last_synced_hash: string | null;
};
async function google<T>(companyId:string, url: string, method = "GET", body?: object): Promise<T> {
  // Never send credentials to a URL supplied by an operator or spreadsheet cell.
  const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + url, {
    method,
    headers: { Authorization: "Bearer " + await googleAccessToken(companyId),
      ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(
    "Google Sheets API failed (" + res.status + "). Check Google account permissions and the shared spreadsheet.",
  );
  return await res.json() as T;
}
type SheetInfo = { spreadsheetId: string; properties?: { title: string }; sheets?: { properties: { title: string } }[] };
export async function spreadsheetInfo(companyId:string, id: string): Promise<SheetInfo> {
  return google<SheetInfo>(companyId, encodeURIComponent(id) + "?fields=spreadsheetId,properties.title,sheets.properties.title");
}
const range = (tab: string, cells: string) => encodeURIComponent("'" + tab.replace(/'/g,"''") + "'!" + cells);
async function readValues(companyId:string, id: string, tab: string, cells: string): Promise<string[][]> {
  const result = await google<{ values?: string[][] }>(
    companyId, encodeURIComponent(id) + "/values/" + range(tab,cells),
  );
  return result.values ?? [];
}
async function writeValues(companyId:string, id: string, tab: string, cell: string, values: unknown[][]) {
  if (!values.length) return;
  await google(companyId, encodeURIComponent(id) + "/values/" + range(tab,cell) + "?valueInputOption=RAW",
    "PUT", { range: "'" + tab.replace(/'/g,"''") + "'!" + cell, majorDimension: "ROWS", values });
}
async function batchRows(companyId:string, id: string, tab: string, updates: { row: number; values: unknown[] }[]) {
  if (!updates.length) return;
  const data = updates.map(u=>({
    range: "'" + tab + "'!A" + u.row + ":K" + u.row,
    majorDimension: "ROWS", values: [u.values],
  }));
  // Google limits batch payloads; never send unbounded requests.
  for (let i=0;i<data.length;i+=100) {
    await google(companyId, encodeURIComponent(id) + "/values:batchUpdate", "POST",
      { valueInputOption: "RAW", data: data.slice(i,i+100) });
  }
}
async function ensureTabs(companyId:string, id: string, sheetNames: readonly string[]) {
  const info = await spreadsheetInfo(companyId,id);
  const existing = new Set((info.sheets ?? []).map(s=>s.properties.title));
  const missing = sheetNames.filter(n=>!existing.has(n));
  if (missing.length)
    await google(companyId, encodeURIComponent(id) + ":batchUpdate", "POST", {
      requests: missing.map(title=>({ addSheet: { properties: { title } } })),
    });
  return info;
}
async function allRows(table: string, columns: string, key: string, ids: string | string[]) {
  const rows: Record<string, unknown>[] = [];
  const limit=250;
  for(let offset=0;offset<10000;offset+=limit) {
    let q = db.from(table).select(columns).order("id").range(offset,offset+limit-1);
    q = Array.isArray(ids) ? q.in(key, ids) : q.eq(key,ids);
    const { data, error } = await q;
    if (error) throw new Error("ERP " + table + " query failed: " + error.message);
    rows.push(...((data ?? []) as unknown as Record<string,unknown>[]));
    if ((data ?? []).length < limit) return rows;
  }
  throw new Error("ERP " + table + " exceeds the 10000-record sync safety limit.");
}
async function masters(companyId: string) {
  const [projects, materials, warehouses] = await Promise.all([
    allRows("projects","id,code,name","company_id",companyId),
    allRows("items","id,code,name","company_id",companyId),
    allRows("warehouses","id,code,name","company_id",companyId),
  ]);
  const projectIds=projects.map(p=>String(p["id"]));
  const buildings=projectIds.length ? await allRows("buildings","id,code,name,project_id","project_id",projectIds) : [];
  return { projects: projects as unknown as Master[], materials: materials as unknown as Master[],
    buildings: buildings as unknown as Master[], warehouses: warehouses as unknown as Master[] };
}
function mapByCode(rows: Master[]) {
  const m=new Map<string, Master>();
  for (const x of rows) {
    if(!x.code) continue;
    const key=x.code.trim().toUpperCase();
    if (m.has(key)) throw new Error("Duplicate ERP master code: " + key);
    m.set(key,x);
  }
  return m;
}
function digest(row: HistoricalInput) { return createHash("sha256").update(canonicalHistorical(row)).digest("hex"); }
function inSheet(row: History, lookup: {
  projects: Map<string,Master>; buildings: Map<string,Master>; materials: Map<string,Master>;
}): HistoricalInput {
  const byId=(m:Map<string,Master>,id:string)=>[...m.values()].find(r=>r.id===id)?.code ?? "";
  return {
    reference:row.reference.toUpperCase(), date:row.occurred_on,
    projectCode:byId(lookup.projects,row.project_id).toUpperCase(),
    buildingCode:row.building_id?byId(lookup.buildings,row.building_id).toUpperCase():"",
    materialCode:byId(lookup.materials,row.material_id).toUpperCase(),
    quantity:Number(row.quantity),unitCost:Number(row.unit_cost),purpose:row.purpose??"",
  };
}
function serialize(i: HistoricalInput, id: string, status: string, error=""): unknown[] {
  return [i.reference,i.date,i.projectCode,i.buildingCode,i.materialCode,i.quantity,
    i.unitCost,i.purpose,id,status,error];
}
async function importHistorical(id: string, companyId: string, m: Awaited<ReturnType<typeof masters>>) {
  const projectMap=mapByCode(m.projects), buildingMap=mapByCode(m.buildings),
    materialMap=mapByCode(m.materials);
  const { data, error }=await db.from("erp_historical_material_consumptions")
    .select("id,reference,occurred_on,project_id,building_id,material_id,quantity,unit_cost,purpose,last_synced_hash")
    .eq("company_id",companyId).order("reference").limit(10000);
  if (error) throw new Error(error.message);
  const previous=new Map<string,History>((data as History[]??[]).map(h=>[h.reference,h]));
  const sheet=await readValues(companyId,id,HISTORICAL_TAB,"A1:K5001");
  if (!sheet.length) await writeValues(companyId,id,HISTORICAL_TAB,"A1:K1",[[...HISTORICAL_HEADERS]]);
  else if (HISTORICAL_HEADERS.some((v,j)=>sheet[0]?.[j]!==v))
    throw new Error("Historical Consumption headers were modified. Restore the generated header row.");
  const updates: {row:number;values:unknown[]}[]=[];
  const seen=new Set<string>(); const conflicts:string[]=[];
  let imported=0, exported=0, errors=0;
  for(let index=1;index<sheet.length;index++) {
    const values=sheet[index] ?? [];
    if (!values.slice(0,9).some(x=>String(x??"").trim())) continue;
    const line=index+1;
    const ref=String(values[0]??"").trim().toUpperCase();
    if (/^[A-Z0-9_-]{2,64}$/.test(ref)) seen.add(ref);
    try {
      const input=parseHistoricalRow(values);
      input.reference=input.reference.toUpperCase();
      input.projectCode=input.projectCode.toUpperCase();
      input.buildingCode=input.buildingCode.toUpperCase();
      input.materialCode=input.materialCode.toUpperCase();
      if(sheet.slice(1,index).some(r=>String(r?.[0]??"").trim().toUpperCase()===input.reference))
        throw new Error("Duplicate Reference in this worksheet.");
      const old=previous.get(input.reference);
      if(old && String(values[8]??"").trim() && values[8]!==old.id)
        throw new Error("ERP Record ID does not match this Reference.");
      if (!old && String(values[8]??"").trim())
        throw new Error("Unknown ERP Record ID. Do not copy the ID from another row.");
      const project=projectMap.get(input.projectCode), material=materialMap.get(input.materialCode);
      const building=input.buildingCode?buildingMap.get(input.buildingCode):null;
      if(!project) throw new Error("Unknown Project Code.");
      if(!material) throw new Error("Unknown Material Code.");
      if(input.buildingCode && (!building || building.project_id!==project.id))
        throw new Error("Building Code is not part of the selected project.");
      const fromSheet=digest(input);
      const fromErp=old?inSheet(old,{projects:projectMap,buildings:buildingMap,materials:materialMap}):null;
      const erpHash=fromErp?digest(fromErp):null;
      const action=decideHistoricalConflict(old?.last_synced_hash??null,erpHash,fromSheet);
      if(action==="conflict") {
        conflicts.push(input.reference);
        updates.push({row:line,values:serialize(input,old!.id,"CONFLICT","ERP and Google Sheets both changed. Resolve manually.")});
        continue;
      }
      if(action==="import") {
        const payload={
          company_id:companyId,reference:input.reference,occurred_on:input.date,
          project_id:project.id,building_id:building?.id??null,material_id:material.id,
          quantity:input.quantity,unit_cost:input.unitCost,purpose:input.purpose,
          last_synced_hash:fromSheet,updated_at:new Date().toISOString(),
        };
        const saved=await db.from("erp_historical_material_consumptions")
          .upsert(payload,{onConflict:"company_id,reference"}).select("id").single();
        if(saved.error || !saved.data) throw new Error("ERP save failed: "+(saved.error?.message??"unknown"));
        previous.set(input.reference,{...payload,id:String(saved.data.id),last_synced_hash:fromSheet});
        imported++;
        updates.push({row:line,values:serialize(input,String(saved.data.id),"SYNCED")});
      } else if(action==="export") {
        const corrected=fromErp!;
        updates.push({row:line,values:serialize(corrected,old!.id,"SYNCED")});
        const saved=await db.from("erp_historical_material_consumptions")
          .update({last_synced_hash:erpHash}).eq("company_id",companyId).eq("id",old!.id);
        if(saved.error) throw new Error(saved.error.message);
        exported++;
      } else if(values[9]!=="SYNCED" || values[10]) {
        updates.push({row:line,values:serialize(input,old!.id,"SYNCED")});
      }
    } catch (e) {
      errors++;
      updates.push({row:line,values:[...Array.from({length:9},(_,i)=>values[i]??""),"ERROR",
        e instanceof Error?e.message.slice(0,240):"Invalid input"]});
    }
  }
  // Add ERP records missing in the spreadsheet; deleting a sheet row never deletes ERP history.
  const append:unknown[][]=[];
  for (const historical of previous.values()) {
    if(seen.has(historical.reference)) continue;
    append.push(serialize(inSheet(historical,{projects:projectMap,buildings:buildingMap,materials:materialMap}),
      historical.id,"SYNCED"));
  }
  await batchRows(companyId,id,HISTORICAL_TAB,updates);
  if(append.length) {
    await google(companyId,encodeURIComponent(id) + "/values/" + range(HISTORICAL_TAB,"A:K") +
      ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS","POST",
      { majorDimension:"ROWS",values:append });
    exported+=append.length;
  }
  return { imported, exported, errors, conflicts:conflicts.slice(0,50) };
}
async function exportTab(companyId:string, id:string, name:string, rows:Record<string,unknown>[], columns:readonly string[]) {
  const headings=["ERP ID",...columns.filter(x=>x!=="id")];
  if(rows.length>=10000) throw new Error(name+" exceeds export safety limit.");
  // Refuse to overwrite a pre-existing sheet that is not an ERP-generated mirror.
  const firstRow=(await readValues(companyId,id,name,"A1:Z1"))[0]??[];
  if(firstRow.some(c=>String(c).trim()) && headings.some((h,i)=>firstRow[i]!==h))
    throw new Error("Reserved worksheet contains unexpected headers; rename or back it up.");
  // These dedicated tabs are explicitly read-only mirrors. Staff edits are overwritten.
  await google(companyId,encodeURIComponent(id)+"/values/"+range(name,"A1:Z10001")+":clear","POST",{});
  const values=[headings,...rows.map(r=>headings.map(c=>{
    const value=r[c==="ERP ID"?"id":c];
    return value===null||value===undefined?"":String(value);
  }))];
  for(let offset=0;offset<values.length;offset+=500)
    await writeValues(companyId,id,name,"A"+(offset+1)+":Z"+(offset+Math.min(500,values.length-offset)),values.slice(offset,offset+500));
}
export async function googleSheetStatus(companyId: string) {
  const {data,error}=await db.from("erp_google_sheet_connections")
    .select("company_id,spreadsheet_id,spreadsheet_title,enabled,last_synced_at,last_error,last_result,sync_lease_until,oauth_account_email")
    .eq("company_id",companyId).maybeSingle();
  if(error) throw new Error(error.message);
  return { connection: data as Connection | null, oauthConfigured:googleOAuthConfigured(), googleAccountEmail: (data as (Connection & {oauth_account_email?:string})|null)?.oauth_account_email??null };
}
export async function syncGoogleSheet(companyId:string) {
  const now=new Date(); const lease=new Date(now.getTime()+5*60_000).toISOString();
  const {data:claimed,error:claimError}=await db.from("erp_google_sheet_connections")
    .update({sync_lease_until:lease})
    .eq("company_id",companyId).eq("enabled",true)
    .or("sync_lease_until.is.null,sync_lease_until.lt."+now.toISOString())
    .select("company_id,spreadsheet_id").maybeSingle();
  if(claimError) throw new Error(claimError.message);
  if(!claimed) return { busy:true };
  const id=String(claimed.spreadsheet_id);
  try {
    const info=await ensureTabs(companyId,id,[...EXPORT_TABS.map(x=>x.name),HISTORICAL_TAB]);
    const scope=await masters(companyId);
    const results:Record<string,string>={};
    // A broken secondary export must not prevent historical entries from importing.
    for(const tab of EXPORT_TABS) {
      try {
        const columns=tab.columns.split(",");
        const rows=tab.table==="buildings" ? scope.buildings as unknown as Record<string,unknown>[]
          : await allRows(tab.table,tab.columns,tab.companyColumn,companyId);
        await exportTab(companyId,id,tab.name,rows,columns);
        results[tab.name]="exported "+rows.length+" records";
      } catch(err) {
        results[tab.name]="failed: "+(err instanceof Error?err.message:"unknown");
      }
    }
    const history=await importHistorical(id,companyId,scope);
    const output={...history,exports:results,at:new Date().toISOString()};
    const exportFailures=Object.values(results).filter(v=>v.startsWith("failed:"));
    const saved=await db.from("erp_google_sheet_connections").update({
      spreadsheet_title:info.properties?.title??"",last_synced_at:output.at,
      last_error:exportFailures.length?exportFailures.length+" export tab(s) failed; see details.":null,
      last_result:output,
    }).eq("company_id",companyId);
    if(saved.error) throw new Error(saved.error.message);
    return output;
  } catch(err) {
    const message=err instanceof Error?err.message:"Sync failed";
    await db.from("erp_google_sheet_connections").update({last_error:message.slice(0,400)}).eq("company_id",companyId);
    throw err;
  } finally {
    await db.from("erp_google_sheet_connections").update({sync_lease_until:null}).eq("company_id",companyId)
      .eq("sync_lease_until",lease);
  }
}
