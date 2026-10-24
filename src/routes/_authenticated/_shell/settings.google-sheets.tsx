import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, RefreshCcw, ExternalLink, ShieldCheck, Link2, FileSpreadsheet, KeyRound, ClipboardCheck } from "lucide-react";
import { useMe } from "@/lib/session";
import { PageHeader, Loading } from "@/components/erp/common";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getGoogleSheetsConnection,connectGoogleSheets,
  syncGoogleSheetsNow,setGoogleSheetsEnabled,getGoogleSheetImports,applyGoogleSheetImport,pasteSpreadsheetEntries } from "@/lib/google-sheets.functions";
import { EXPORT_TABS,HISTORICAL_HEADERS,HISTORICAL_TAB,SHEET_ENTRY_TABS } from "@/lib/google-sheets-model";

export const Route=createFileRoute("/_authenticated/_shell/settings/google-sheets")({
  head:()=>({meta:[{title:"Google Sheets Integration — KK GROUP ERP"}]}),
  component:SheetsSettings,
});
const statusLabel=(s:string)=>s==="ready"?"Ready to import":s==="applied"?"Imported":s==="conflict"?"Conflict":s==="processing"?"Processing":s==="error"?"Needs attention":s;
function SheetsSettings() {
  const me=useMe(),qc=useQueryClient();
  const allowed=!!me.data?.profile.is_active&&!!me.data?.roles.includes("super_admin");
  const [url,setUrl]=useState("");
  const [pendingImport,setPendingImport]=useState<string|null>(null);
  const [pasteKind,setPasteKind]=useState<"costing"|"challan"|"invoice"|"historical">("costing");
  const [clipboard,setClipboard]=useState("");
  const [pasteResult,setPasteResult]=useState<{added:number;updated:number;unchanged:number;rejected:number;rowErrors:{row:number;message:string}[]}|null>(null);
  const get=useServerFn(getGoogleSheetsConnection);
  const connect=useServerFn(connectGoogleSheets);
  const sync=useServerFn(syncGoogleSheetsNow);
  const toggle=useServerFn(setGoogleSheetsEnabled);
  const importsFn=useServerFn(getGoogleSheetImports);
  const applyFn=useServerFn(applyGoogleSheetImport);
  const pasteFn=useServerFn(pasteSpreadsheetEntries);
  const status=useQuery({queryKey:["google-sheets-connection"],enabled:allowed,
    queryFn:()=>get(),refetchInterval:30_000,retry:false});
  const imports=useQuery({queryKey:["google-sheets-imports"],enabled:allowed,
    queryFn:()=>importsFn(),refetchInterval:30_000,retry:false});
  const invalidate=()=>{
    void qc.invalidateQueries({queryKey:["google-sheets-connection"]});
    void qc.invalidateQueries({queryKey:["google-sheets-imports"]});
  };
  useEffect(()=>{
    const flag=new URLSearchParams(window.location.search).get("google");
    if(flag==="connected")toast.success("Google account connected successfully.");
    if(flag==="failed")toast.error("Google authorization failed. Check deployment configuration or spreadsheet access.");
    if(flag==="denied")toast.error("Google account access was not granted.");
    if(flag){const next=new URL(window.location.href);next.searchParams.delete("google");window.history.replaceState(null,"",next.toString());}
  },[]);
  const save=useMutation({
    mutationFn:()=>connect({data:{url}}),
    onSuccess:(value)=>{window.location.assign(value.authorizationUrl);},
    onError:e=>toast.error(e.message),
  });
  const run=useMutation({
    mutationFn:()=>sync(),
    onSuccess:value=>{
      if("busy" in value)toast.message("Another synchronization is already running.");
      else toast.success("Sync finished. Review any entry errors before importing documents.");
      invalidate();
    },
    onError:e=>{toast.error(e.message);invalidate();},
  });
  const enable=useMutation({
    mutationFn:(enabled:boolean)=>toggle({data:{enabled}}),
    onSuccess:()=>{toast.success("Sync setting updated");invalidate();},
    onError:e=>toast.error(e.message),
  });
  const apply=useMutation({
    mutationFn:(id:string)=>applyFn({data:{id}}),
    onSuccess:()=>{toast.success("ERP document imported using its controlled workflow.");setPendingImport(null);invalidate();},
    onError:e=>{toast.error(e.message);invalidate();},
  });
  const paste=useMutation({
    mutationFn:()=>pasteFn({data:{kind:pasteKind,clipboard}}),
    onSuccess:value=>{setPasteResult(value);setClipboard("");
      toast.success("Validated rows staged for ERP review.");invalidate();},
    onError:e=>{toast.error(e.message);setPasteResult(null);},
  });
  if(me.isLoading)return <Loading/>;
  if(!allowed)return <p role="alert">Only an active company Super Admin can manage Google Sheets.</p>;
  const connection=status.data?.connection;
  const connected=!!status.data?.googleAccountEmail&&!!connection;
  const entries=imports.data??[];
  const ready=entries.filter(x=>x.status==="ready").length;
  const applied=entries.filter(x=>x.status==="applied").length;
  const needsAttention=entries.filter(x=>x.status==="error"||x.status==="conflict").length;
  return <div className="mx-auto max-w-6xl pb-20">
    <PageHeader title="Google Sheets Integration" subtitle="Paste rows directly from your Google Sheet or Excel. No Google Cloud client, service-account JSON, or public sharing required."/>
    <div className="mb-5 flex gap-3 rounded-xl border bg-card p-4 text-sm">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary"/>
      <div><p className="font-semibold">Super Admin controlled · ERP remains the system of record</p>
        <p className="mt-1 text-muted-foreground">Spreadsheet rows are reviewed before registration. Vendor challans use the existing PO-controlled workflow; vendor invoices become drafts matched to GRNs. Neither automatically posts stock, cash or approved accounts payable.</p>
      </div>
    </div>
    <section className="rounded-xl border bg-card p-4 sm:p-6" aria-label="Direct copy and paste import">
      <div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-primary"/><h2 className="font-semibold">1. Import directly — no Google setup</h2></div>
      <p className="mt-2 text-sm text-muted-foreground">Open the existing KK ERP Spreadsheet in Google Sheets, select the complete header row and your filled rows, press Copy (⌘C / Ctrl+C), then paste below. We validate the entries and save them as pending ERP imports. You review every document before it is registered. The Google Sheet stays private.</p>
      <form className="mt-4 space-y-3" onSubmit={e=>{e.preventDefault();paste.mutate();}}>
        <div className="space-y-2">
          <Label htmlFor="paste-kind">Spreadsheet worksheet</Label>
          <select id="paste-kind" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:max-w-md" value={pasteKind}
            onChange={e=>{setPasteKind(e.target.value as typeof pasteKind);setClipboard("");setPasteResult(null);}}>
            {SHEET_ENTRY_TABS.map(tab=><option key={tab.kind} value={tab.kind}>{tab.name}</option>)}
            <option value="historical">{HISTORICAL_TAB}</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="paste-rows">Paste copied spreadsheet cells (header + data)</Label>
          <Textarea id="paste-rows" rows={7} value={clipboard} onChange={e=>setClipboard(e.target.value)}
            placeholder={"Select the full header row and filled rows in the '"+(pasteKind==="historical"?HISTORICAL_TAB:SHEET_ENTRY_TABS.find(t=>t.kind===pasteKind)?.name)+"' tab, copy, and paste here."}
            className="font-mono text-xs" required/>
          <p className="text-xs text-muted-foreground">Up to 500 data rows per paste. Keep all template columns in the original order. Use existing ERP project/vendor/PO/GRN codes. The imported content is a snapshot and will not update itself when the Sheet changes.</p>
        </div>
        <Button disabled={!clipboard.trim()||paste.isPending} type="submit">
          <ClipboardCheck className="mr-2 h-4 w-4"/>{paste.isPending?"Validating rows…":"Validate and stage for review"}
        </Button>
      </form>
      {pasteResult&&<div role="status" className="mt-4 rounded-lg border p-3 text-sm">
        <p className="font-semibold">{pasteResult.added} new documents · {pasteResult.updated} updated drafts · {pasteResult.unchanged} unchanged · {pasteResult.rejected} row issue(s)</p>
        <p className="mt-1 text-muted-foreground">Valid entries appear in the review queue below. Nothing is posted without your confirmation.</p>
        {pasteResult.rowErrors.length>0&&<div className="mt-3 max-h-48 overflow-auto text-xs text-destructive">
          {pasteResult.rowErrors.map((error,i)=><p key={i}>Row {error.row}: {error.message}</p>)}
        </div>}
      </div>}
    </section>
    <details className="mt-5 rounded-xl border bg-card p-4 sm:p-6">
      <summary className="cursor-pointer font-semibold">Optional: automatic Google synchronization (requires a separate Google authorization)</summary>
      <p className="mt-2 text-sm text-muted-foreground">You do not need this for direct imports. Google requires authorization for unattended syncing of a private worksheet. You can use the direct paste option above without this setup.</p>
      <div className="mt-4">
    <section className="rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary"/><h2 className="font-semibold">Connect Google for optional background sync</h2></div>
      <p className="mt-2 text-sm text-muted-foreground">No service-account JSON required. Use your Google account to approve access to one spreadsheet. Your Google account and refresh token stay server-side; ERP staff cannot view the credentials.</p>
      {status.isLoading?<p className="mt-4 text-sm">Checking Google setup…</p>:
        !status.data?.oauthConfigured?<div role="alert" className="mt-4 rounded-lg border border-amber-300 p-3 text-sm">
          <p className="font-semibold">One-time deployment setup needed</p>
          <p className="mt-1">Configure GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI and GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY on the ERP server, then apply the Google Sheets database migrations. This is application setup, not a JSON file you need to upload.</p>
        </div>:
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-sm">
          {connected?<CheckCircle2 className="h-5 w-5 text-emerald-600"/>:<KeyRound className="h-5 w-5 text-primary"/>}
          <div><p className="font-semibold">{connected?"Google account connected":"Ready for Google sign-in"}</p>
            {connected&&<p className="break-all text-muted-foreground">{status.data?.googleAccountEmail}</p>}
          </div>
        </div>
      }
      <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={e=>{e.preventDefault();save.mutate();}}>
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="sheet-url">Google Spreadsheet URL</Label>
          <Input id="sheet-url" type="url" value={url} onChange={e=>setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…/edit" required/>
        </div>
        <Button type="submit" disabled={save.isPending||!status.data?.oauthConfigured}>
          <KeyRound className="mr-2 h-4 w-4"/>{save.isPending?"Preparing…":connected?"Change Google account / workbook":"Connect with Google"}
        </Button>
      </form>
      {connection&&<div className="mt-5 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold"><FileSpreadsheet className="h-4 w-4"/>{connection.spreadsheet_title||"Saved spreadsheet"}</p>
            <a className="mt-1 inline-flex items-center gap-1 break-all text-sm text-primary underline" target="_blank" rel="noopener noreferrer"
              href={"https://docs.google.com/spreadsheets/d/"+connection.spreadsheet_id+"/edit"}>
              Open connected spreadsheet <ExternalLink className="h-3.5 w-3.5"/>
            </a>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={enable.isPending||!connected}
              onClick={()=>enable.mutate(!connection.enabled)}>{connection.enabled?"Pause auto-sync":"Resume auto-sync"}</Button>
            <Button size="sm" disabled={!connected||!connection.enabled||run.isPending}
              onClick={()=>run.mutate()}><RefreshCcw className="mr-2 h-4 w-4"/>{run.isPending?"Synchronizing…":"Sync now"}</Button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Sync setting</p><p className="font-medium">{connection.enabled?"Enabled":"Paused"}</p></div>
          <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Last successful sync</p><p className="font-medium">{connection.last_synced_at?new Date(connection.last_synced_at).toLocaleString("en-IN"):"Not yet synced"}</p></div>
          <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Historical usage imported on last sync</p><p className="font-medium">{String(connection.last_result?.imported??"—")}</p></div>
        </div>
        {connection.last_error&&<p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"><AlertTriangle className="h-4 w-4 shrink-0"/>{connection.last_error}</p>}
        {connection.last_result&&<details className="mt-3 rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Last sync report and errors</summary>
          <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(connection.last_result,null,2)}</pre>
        </details>}
      </div>}
    </section>
      </div>
    </details>
    <section className="mt-5 rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-primary"/><h2 className="font-semibold">2. Review and approve ERP imports</h2></div>
      <p className="mt-2 text-sm text-muted-foreground">Your pasted rows (or rows from an optional authorized Google sync) are validated and queued here. Inspect each record, then confirm its import into ERP. A vendor invoice becomes a <strong>draft</strong>; it does not automatically get approved or paid. The records below are not created until you confirm.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-lg border p-3"><p className="text-muted-foreground">Awaiting review</p><p className="text-xl font-semibold">{ready}</p></div>
        <div className="rounded-lg border p-3"><p className="text-muted-foreground">Applied to ERP</p><p className="text-xl font-semibold">{applied}</p></div>
        <div className="rounded-lg border p-3"><p className="text-muted-foreground">Needs attention</p><p className="text-xl font-semibold">{needsAttention}</p></div>
      </div>
      {imports.isLoading?<p className="mt-4 text-sm text-muted-foreground">Loading staged entries…</p>:
        imports.error?<p role="alert" className="mt-4 text-sm text-destructive">{imports.error.message}</p>:
        entries.length===0?<p className="mt-4 rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">No pending imports yet. Copy rows from your spreadsheet and use the direct import form above.</p>:
        <div className="mt-4 space-y-2">
          {entries.map(entry=><div key={entry.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{entry.source_reference} <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs font-medium">{entry.document_type}</span> <span className="ml-1 rounded bg-muted px-2 py-0.5 text-xs font-medium">{entry.source_type==="paste"?"Direct paste":"Google sync"}</span></p>
                <p className="text-xs text-muted-foreground">{statusLabel(entry.status)}{entry.erp_record_id?" · ERP record "+entry.erp_record_id:""}</p>
              </div>
              {(entry.status==="ready"||entry.status==="error")&&<Button size="sm" variant="outline" disabled={apply.isPending||(entry.source_type==="google"&&!connected)}
                onClick={()=>setPendingImport(current=>current===entry.id?null:entry.id)}>{pendingImport===entry.id?"Close review":"Review entry"}</Button>}
            </div>
            {entry.error_message&&<p role="alert" className="mt-2 text-xs text-destructive">{entry.error_message}</p>}
            {pendingImport===entry.id?<div className="mt-3 rounded-lg border bg-muted/30 p-3">
              <p className="text-sm font-semibold">Confirm {entry.document_type} import</p>
              <p className="mt-1 text-xs text-muted-foreground">Verify the source references, quantities and amounts. For Google-connected imports the ERP checks the live sheet again before applying. For direct paste, this is a reviewed snapshot; spreadsheet changes require a new paste.</p>
              <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-card p-3 text-xs">{JSON.stringify(entry.payload,null,2)}</pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" disabled={apply.isPending} onClick={()=>apply.mutate(entry.id)}>
                  {apply.isPending&&apply.variables===entry.id?"Importing…":"Confirm import into ERP"}
                </Button>
                <Button size="sm" variant="outline" disabled={apply.isPending} onClick={()=>setPendingImport(null)}>Cancel</Button>
              </div>
            </div>:
              <details className="mt-2 text-xs"><summary className="cursor-pointer text-primary">Inspect document details</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2">{JSON.stringify(entry.payload,null,2)}</pre>
              </details>}
          </div>)}
        </div>}
    </section>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">3. Your entry worksheets</h2>
        <div className="mt-3 space-y-2 text-sm">
          {SHEET_ENTRY_TABS.map(t=><p className="rounded-md border px-3 py-2" key={t.name}>{t.name}</p>)}
          <p className="rounded-md border px-3 py-2">{HISTORICAL_TAB}</p>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Historical material entries use these columns: {HISTORICAL_HEADERS.slice(0,8).join(" · ")}. Existing history is separate from live warehouse stock and should be reconciled before any financial backfill.</p>
        <p className="mt-3 text-xs text-muted-foreground">Use actual ERP project, building, material, vendor, PO and GRN reference codes. GRN Line No is based on the ERP - GRN Item References export.</p>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">4. Optional ERP exports (read-only)</h2>
        <p className="mt-2 text-sm text-muted-foreground">Source documents are mirrored into dedicated worksheets for reference; edits to them do not bypass approvals, payments or stock posting.</p>
        <div className="mt-3 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
          {EXPORT_TABS.map(t=><div key={t.name} className="rounded-md border px-3 py-2">{t.name.replace("ERP - ","")}</div>)}
          <div className="rounded-md border px-3 py-2">GRN Item References</div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Automatic background sync is scheduled every 5 minutes through the Supabase database once the scheduler is activated. Verify freshness above under Last successful sync. Changing a worksheet is not an instant financial transaction.</p>
      </section>
    </div>
  </div>;
}
