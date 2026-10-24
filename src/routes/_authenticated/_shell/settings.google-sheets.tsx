import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, RefreshCcw, ExternalLink, ShieldCheck, Link2 } from "lucide-react";
import { useMe } from "@/lib/session";
import { PageHeader, Loading } from "@/components/erp/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getGoogleSheetsConnection,connectGoogleSheets,
  syncGoogleSheetsNow,setGoogleSheetsEnabled } from "@/lib/google-sheets.functions";
import { EXPORT_TABS,HISTORICAL_HEADERS,HISTORICAL_TAB } from "@/lib/google-sheets-model";

export const Route=createFileRoute("/_authenticated/_shell/settings/google-sheets")({
  head:()=>({meta:[{title:"Google Sheets Integration — KK GROUP ERP"}]}),
  component:SheetsSettings,
});
function SheetsSettings() {
  const me=useMe(), qc=useQueryClient();
  const allowed=!!me.data?.profile.is_active && !!me.data?.roles.includes("super_admin");
  const [url,setUrl]=useState("");
  const get=useServerFn(getGoogleSheetsConnection);
  const connect=useServerFn(connectGoogleSheets);
  const sync=useServerFn(syncGoogleSheetsNow);
  const toggle=useServerFn(setGoogleSheetsEnabled);
  const status=useQuery({queryKey:["google-sheets-connection"],enabled:allowed,
    queryFn:()=>get(),refetchInterval:30_000,retry:false});
  const invalidate=()=>void qc.invalidateQueries({queryKey:["google-sheets-connection"]});
  const save=useMutation({
    mutationFn:()=>connect({data:{url}}),
    onSuccess:(value)=>{toast.success("Connected to "+value.title);setUrl("");invalidate();},
    onError:(e)=>toast.error(e.message),
  });
  const run=useMutation({
    mutationFn:()=>sync(),
    onSuccess:(value)=>{
      if("busy" in value) toast.message("Another sync is already running.");
      else toast.success("Sync completed. Imported "+value.imported+" historical entries.");
      invalidate();
    },
    onError:(e)=>{toast.error(e.message);invalidate();},
  });
  const enable=useMutation({
    mutationFn:(enabled:boolean)=>toggle({data:{enabled}}),
    onSuccess:()=>{toast.success("Sync setting updated");invalidate();},
    onError:(e)=>toast.error(e.message),
  });
  if(me.isLoading) return <Loading/>;
  if(!allowed) return <p role="alert">Only an active Super Admin can manage Google Sheets.</p>;
  const connection=status.data?.connection;
  return <div className="mx-auto max-w-6xl pb-20">
    <PageHeader title="Google Sheets Integration" subtitle="Connect one spreadsheet with multiple worksheets. Import historical project usage and mirror ERP records automatically."/>
    <div className="mb-5 flex gap-3 rounded-xl border bg-card p-4 text-sm">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary"/>
      <div><p className="font-semibold">Super Admin managed · ERP remains the system of record</p>
        <p className="mt-1 text-muted-foreground">Historical consumption can be entered in Google Sheets. Approved purchases, invoices, payments, and stock ledger records are read-only mirrors — editing those worksheet cells will not bypass ERP approval controls.</p></div>
    </div>
    <section className="rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary"/><h2 className="font-semibold">1. Connect your Google Spreadsheet</h2></div>
      <p className="mt-2 text-sm text-muted-foreground">Paste the full Google Sheets URL. The link alone does not grant access: share the spreadsheet with this secure service account as an Editor. Do not make your sheet public.</p>
      <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">
        <p className="font-medium">Google account to share with</p>
        {status.isLoading?<span>Checking configuration…</span>:
         status.data?.serviceEmail?<code className="mt-1 block break-all select-all">{status.data.serviceEmail}</code>:
         <p role="alert" className="mt-1 text-destructive">Server setup required: GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is not configured. Contact the deployment administrator.</p>}
      </div>
      <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={e=>{e.preventDefault();save.mutate();}}>
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="sheet-url">Spreadsheet link</Label>
          <Input id="sheet-url" type="url" value={url} onChange={e=>setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…/edit" required/>
        </div>
        <Button type="submit" disabled={save.isPending||!status.data?.serviceEmail}>
          {save.isPending?"Connecting…":"Connect spreadsheet"}
        </Button>
      </form>
      {connection&&<div className="mt-5 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4 text-emerald-600"/>{connection.spreadsheet_title||"Connected spreadsheet"}</p>
            <a className="mt-1 inline-flex items-center gap-1 break-all text-sm text-primary underline" target="_blank" rel="noopener noreferrer"
              href={"https://docs.google.com/spreadsheets/d/"+connection.spreadsheet_id+"/edit"}>
              Open spreadsheet <ExternalLink className="h-3.5 w-3.5"/>
            </a>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={enable.isPending}
              onClick={()=>enable.mutate(!connection.enabled)}>{connection.enabled?"Pause automatic sync":"Resume sync"}</Button>
            <Button size="sm" disabled={!connection.enabled||run.isPending}
              onClick={()=>run.mutate()}><RefreshCcw className="h-4 w-4"/>{run.isPending?"Synchronizing…":"Sync now"}</Button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Sync status</p><p className="font-medium">{connection.enabled?"Enabled":"Paused"}</p></div>
          <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Last successful sync</p><p className="font-medium">{connection.last_synced_at?new Date(connection.last_synced_at).toLocaleString("en-IN"):"Not yet synced"}</p></div>
          <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Historical entries imported</p><p className="font-medium">{String(connection.last_result?.imported??"—")}</p></div>
        </div>
        {connection.last_error&&<p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"><AlertTriangle className="h-4 w-4 shrink-0"/>{connection.last_error}</p>}
        {connection.last_result&&<details className="mt-3 rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">View last sync details</summary>
          <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(connection.last_result,null,2)}</pre>
        </details>}
      </div>}
    </section>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">2. Enter old project consumption</h2>
        <p className="mt-2 text-sm text-muted-foreground">After connecting, click Sync now once. In Google Sheets open <strong>{HISTORICAL_TAB}</strong> and fill these columns:</p>
        <div className="mt-3 max-h-56 overflow-y-auto rounded-md border p-3">
          <ol className="list-inside list-decimal space-y-1 text-xs">{HISTORICAL_HEADERS.slice(0,8).map(h=><li key={h}>{h}</li>)}</ol>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Example: LEGACY-001 · 2025-05-15 · PROJECT-A · TOWER-A · CEMENT-OPC · 500 · 350 · Slab work. Match the actual ERP codes shown in the export tabs. Keep one unique Reference per record; do not edit ERP Record ID.</p>
        <p className="mt-3 text-xs font-medium">These historical records are not GRNs, stock issues or cash payments. They do not reduce present stock. Reconcile opening stock separately.</p>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">3. Auto-updated ERP worksheets</h2>
        <p className="mt-2 text-sm text-muted-foreground">Dedicated ERP tabs update from source records. Each worksheet is part of the same connected spreadsheet.</p>
        <div className="mt-3 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
          {EXPORT_TABS.map(t=><div key={t.name} className="rounded-md border px-3 py-2">{t.name.replace("ERP - ","")}</div>)}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Those mirror tabs are export-only. ERP permission checks, posting actions, amendments and reversals remain inside the application. Automatic polling needs the separate scheduler and secret described in the deployment documentation; it cannot be activated by saving a URL alone.</p>
      </section>
    </div>
  </div>;
}
