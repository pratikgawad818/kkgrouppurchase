import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, RefreshCcw, ExternalLink, ShieldCheck, Link2, FileSpreadsheet, KeyRound, ClipboardCheck } from "lucide-react";
import { useMe } from "@/lib/session";
import { PageHeader, Loading } from "@/components/erp/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getGoogleSheetsConnection,connectGoogleSheets,
  syncGoogleSheetsNow,setGoogleSheetsEnabled,getGoogleSheetImports,applyGoogleSheetImport } from "@/lib/google-sheets.functions";
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
  const get=useServerFn(getGoogleSheetsConnection);
  const connect=useServerFn(connectGoogleSheets);
  const sync=useServerFn(syncGoogleSheetsNow);
  const toggle=useServerFn(setGoogleSheetsEnabled);
  const importsFn=useServerFn(getGoogleSheetImports);
  const applyFn=useServerFn(applyGoogleSheetImport);
  const status=useQuery({queryKey:["google-sheets-connection"],enabled:allowed,
    queryFn:()=>get(),refetchInterval:30_000,retry:false});
  const imports=useQuery({queryKey:["google-sheets-imports"],enabled:allowed&&!!status.data?.googleAccountEmail,
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
    onSuccess:()=>{toast.success("ERP document imported using its controlled workflow.");invalidate();},
    onError:e=>{toast.error(e.message);invalidate();},
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
    <PageHeader title="Google Sheets Integration" subtitle="One Google account and workbook for historical consumption, project costing, vendor challans and vendor invoice drafts."/>
    <div className="mb-5 flex gap-3 rounded-xl border bg-card p-4 text-sm">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary"/>
      <div><p className="font-semibold">Super Admin controlled · ERP remains the system of record</p>
        <p className="mt-1 text-muted-foreground">Spreadsheet rows are reviewed before registration. Vendor challans use the existing PO-controlled workflow; vendor invoices become drafts matched to GRNs. Neither automatically posts stock, cash or approved accounts payable.</p>
      </div>
    </div>
    <section className="rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary"/><h2 className="font-semibold">1. Connect Google account</h2></div>
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
    <section className="mt-5 rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-primary"/><h2 className="font-semibold">2. Review imported spreadsheet entries</h2></div>
      <p className="mt-2 text-sm text-muted-foreground">Sync reads the entry worksheets and validates each reference. Choose <strong>Import</strong> to register a validated record in ERP. A vendor invoice becomes a <strong>draft</strong>; it does not automatically get approved or paid. The records below are not created until you confirm.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-lg border p-3"><p className="text-muted-foreground">Awaiting review</p><p className="text-xl font-semibold">{ready}</p></div>
        <div className="rounded-lg border p-3"><p className="text-muted-foreground">Applied to ERP</p><p className="text-xl font-semibold">{applied}</p></div>
        <div className="rounded-lg border p-3"><p className="text-muted-foreground">Needs attention</p><p className="text-xl font-semibold">{needsAttention}</p></div>
      </div>
      {imports.isLoading?<p className="mt-4 text-sm text-muted-foreground">Loading staged entries…</p>:
        imports.error?<p role="alert" className="mt-4 text-sm text-destructive">{imports.error.message}</p>:
        entries.length===0?<p className="mt-4 rounded-lg bg-muted/30 p-4 text-sm text-muted-foreground">No staged entries yet. Fill a worksheet and click Sync now. Imported data will appear here after validation.</p>:
        <div className="mt-4 space-y-2">
          {entries.map(entry=><div key={entry.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{entry.source_reference} <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs font-medium">{entry.document_type}</span></p>
                <p className="text-xs text-muted-foreground">{statusLabel(entry.status)}{entry.erp_record_id?" · ERP record "+entry.erp_record_id:""}</p>
              </div>
              {(entry.status==="ready"||entry.status==="error")&&<Button size="sm" disabled={apply.isPending||!connected}
                onClick={()=>apply.mutate(entry.id)}>{apply.isPending&&apply.variables===entry.id?"Importing…":"Review & import"}</Button>}
            </div>
            {entry.error_message&&<p role="alert" className="mt-2 text-xs text-destructive">{entry.error_message}</p>}
            <details className="mt-2 text-xs"><summary className="cursor-pointer text-primary">Inspect document details before importing</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2">{JSON.stringify(entry.payload,null,2)}</pre>
            </details>
          </div>)}
        </div>}
    </section>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">3. Editable entry worksheets</h2>
        <div className="mt-3 space-y-2 text-sm">
          {SHEET_ENTRY_TABS.map(t=><p className="rounded-md border px-3 py-2" key={t.name}>{t.name}</p>)}
          <p className="rounded-md border px-3 py-2">{HISTORICAL_TAB}</p>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Historical material entries use these columns: {HISTORICAL_HEADERS.slice(0,8).join(" · ")}. Existing history is separate from live warehouse stock and should be reconciled before any financial backfill.</p>
        <p className="mt-3 text-xs text-muted-foreground">Use actual ERP project, building, material, vendor, PO and GRN reference codes. GRN Line No is based on the ERP - GRN Item References export.</p>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">4. ERP exports (read-only)</h2>
        <p className="mt-2 text-sm text-muted-foreground">Source documents are mirrored into dedicated worksheets for reference; edits to them do not bypass approvals, payments or stock posting.</p>
        <div className="mt-3 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
          {EXPORT_TABS.map(t=><div key={t.name} className="rounded-md border px-3 py-2">{t.name.replace("ERP - ","")}</div>)}
          <div className="rounded-md border px-3 py-2">GRN Item References</div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Periodic polling requires the protected scheduler configured in your deployment. Changing a worksheet is not an instant financial transaction.</p>
      </section>
    </div>
  </div>;
}
