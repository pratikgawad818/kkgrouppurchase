import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Clock3, Copy, ExternalLink, MessageCircle, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadCompleteRows } from "@/lib/complete-register";
import { approvalPage, voteFetchChunks } from "@/lib/approval-queue";
import { useMe } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loading, PageHeader } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, inr } from "@/lib/format";
import { approvalMessage, whatsappDraftUrl } from "@/lib/approval-notifications";
import { parseApprovalReference } from "@/lib/director-whatsapp-reference";

type Kind = "purchase_order" | "vendor_payment";
type Request = { id: string; kind: Kind; number: string; amount: number; status: string; projectId: string | null; project: string; vendor: string; createdBy: string };
type Vote = { entity_type: string; entity_id: string; actor_id: string; decision: string; created_at: string };
const linkFor = (request: Request) => request.kind === "purchase_order" ? `/procurement/purchase-orders/${request.id}` : "/finance/payments";

export const Route = createFileRoute("/_authenticated/_shell/approvals")({
  validateSearch: (s: Record<string, unknown>): { kind: Kind | null; id: string | null } => {
    const ref = parseApprovalReference(s["ref"]);
    return {
      kind: ref?.kind ?? (s["kind"] === "purchase_order" || s["kind"] === "vendor_payment" ? s["kind"] : null),
      id: ref?.id ?? (typeof s["id"] === "string" && /^[0-9a-f-]{36}$/i.test(s["id"]) ? s["id"] : null),
    };
  },
  component: DirectorApprovals,
  head: () => ({ meta: [{ title: "Director Approvals — KK GROUP ERP" }] }),
});

function DirectorApprovals() {
  const search = Route.useSearch();
  const me = useMe();
  const qc = useQueryClient();
  const [reason, setReason] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  // Source rollout guard: keep the existing manual WhatsApp workflow usable
  // until 0024 and real staging/browser acceptance have been completed.
  const alertsUiEnabled = import.meta.env.VITE_DIRECTOR_WA_UI_ENABLED === "true";
  const [optInEvidence, setOptInEvidence] = useState<Record<string,string>>({});

  const isDirector = me.data?.roles.includes("director") ?? false;
  const isAdmin = me.data?.permissions.has("users.manage") ?? false;
  const q = useQuery({
    queryKey: ["director-approvals", isAdmin, me.data?.profile.company_id, alertsUiEnabled],
    enabled: isDirector || isAdmin,
    queryFn: async () => {
      const [po, payments] = await Promise.all([
        loadCompleteRows(async (start, end) => await supabase.from("purchase_orders")
          .select("id,po_number,grand_total,status,project_id,created_by,projects(name),vendors(company_name)", { count: "exact" })
          .eq("status", "pending_approval").order("created_at", { ascending: false })
          .order("id", { ascending: false }).range(start, end)),
        loadCompleteRows(async (start, end) => await supabase.from("vendor_payments")
          .select("id,payment_number,amount,status,project_id,created_by,projects(name),vendors(company_name)", { count: "exact" })
          .eq("status", "scheduled").order("created_at", { ascending: false })
          .order("id", { ascending: false }).range(start, end)),
      ]);
      const requests: Request[] = [
        ...po.map(x => ({ id: x.id, kind: "purchase_order" as const, number: x.po_number, amount: Number(x.grand_total), status: x.status, projectId: x.project_id, project: x.projects?.name ?? "Project", vendor: x.vendors?.company_name ?? "Vendor", createdBy: x.created_by })),
        ...payments.map(x => ({ id: x.id, kind: "vendor_payment" as const, number: x.payment_number, amount: Number(x.amount), status: x.status, projectId: x.project_id, project: x.projects?.name ?? "Company-wide", vendor: x.vendors?.company_name ?? "Vendor", createdBy: x.created_by })),
      ];
      const voteBatches = voteFetchChunks(requests);
      const voteResults = await Promise.all(voteBatches.map(batch =>
        loadCompleteRows(async (start, end) => await supabase.from("director_approval_votes")
          .select("id,entity_type,entity_id,actor_id,decision,created_at", { count: "exact" })
          .eq("entity_type", batch.kind).in("entity_id", batch.ids).order("id").range(start, end))
      ));
      const votes: Vote[] = voteResults.flat();
      let directors: { id: string; full_name: string | null; phone: string | null }[] = [];
      const companyId = me.data?.profile.company_id;
      if (isAdmin && companyId) {
        const [profiles, roles] = await Promise.all([
          loadCompleteRows(async (start, end) => await supabase.from("profiles")
            .select("id,full_name,phone,is_active", { count: "exact" })
            .eq("company_id", companyId).eq("is_active", true).order("id").range(start, end)),
          loadCompleteRows(async (start, end) => await supabase.from("user_roles")
            .select("id,user_id", { count: "exact" }).eq("role", "director").order("id").range(start, end)),
        ]);
        const directorIds = new Set(roles.map(r => r.user_id));
        directors = profiles.filter(x => directorIds.has(x.id));
      }
      let directorConsents: {director_id:string;status:string;phone_e164:string|null}[] = [];
      let directorAlerts: {id:string;director_id:string;entity_type:string;entity_id:string;status:string;stage:string;created_at:string;error_code:string|null}[] = [];
      if (alertsUiEnabled && isAdmin && companyId) {
        [directorConsents,directorAlerts] = await Promise.all([
          loadCompleteRows(async (start,end) => await supabase.from("director_wa_consents")
            .select("director_id,status,phone_e164,id:director_id", {count:"exact"})
            .eq("company_id",companyId).order("director_id").range(start,end)),
          loadCompleteRows(async (start,end) => await supabase.from("director_wa_outbox")
            .select("id,director_id,entity_type,entity_id,status,stage,created_at,error_code", {count:"exact"})
            .eq("company_id",companyId).order("created_at",{ascending:false}).order("id",{ascending:false}).range(start,end)),
        ]);
      }
      return { requests, votes, directors, directorConsents, directorAlerts };
    },
  });
  const consentAction = useMutation({
    mutationFn: async ({directorId,granted}: {directorId:string;granted:boolean}) => {
      const evidence = (optInEvidence[directorId] ?? "").trim();
      if (evidence.length < 12 || evidence.length > 500) {
        throw new Error("Record 12-500 characters of real opt-in or opt-out evidence.");
      }
      const result = await supabase.rpc("wa_set_director_consent",{
        _director:directorId,_granted:granted,_evidence:evidence,
      });
      if(result.error) throw result.error;
    },
    onSuccess:()=>{ toast.success("Consent decision recorded"); void qc.invalidateQueries({queryKey:["director-approvals"]}); },
    onError:e=>toast.error(errMsg(e)),
  });
  const prepareAction = useMutation({
    mutationFn: async (r: Request) => {
      const result = await supabase.rpc("wa_prepare_director_notification",{
        _kind:r.kind,_id:r.id,
      });
      if(result.error) throw result.error;
      return result.data;
    },
    onSuccess:(count)=>{ toast.success(count ? count+" notifications queued (not sent)" : "No new eligible notifications"); void qc.invalidateQueries({queryKey:["director-approvals"]}); },
    onError:e=>toast.error(errMsg(e)),
  });
  const action = useMutation({
    mutationFn: async ({ request, decision }: { request: Request; decision: "approved" | "rejected" }) => {
      const comment = (reason[request.id] ?? "").trim();
      if (decision === "rejected" && !comment) throw new Error("Enter a reason for rejection.");
      if (request.kind === "vendor_payment" && decision === "rejected") throw new Error("Payment rejection requires an explicit cancellation workflow. Contact the administrator.");
      const result = request.kind === "purchase_order"
        ? await supabase.rpc("po_transition", { _po_id: request.id, _action: decision, _comment: comment })
        : await supabase.rpc("payment_transition", { _id: request.id, _action: "approve", _comment: comment, _details: {} });
      if (result.error) throw result.error;
    },
    onSuccess: () => { toast.success("Decision recorded"); qc.invalidateQueries({ queryKey: ["director-approvals"] }); qc.invalidateQueries({ queryKey: ["po"] }); qc.invalidateQueries({ queryKey: ["vendor-payments"] }); },
    onError: e => toast.error(errMsg(e)),
  });
  const pending = (q.data?.requests ?? []).filter(r => !search.id || (r.id === search.id && r.kind === search.kind));
  const votesByRequest = q.data?.votes ?? [];
  const directors = q.data?.directors ?? [];
  const directorConsents = q.data?.directorConsents ?? [];
  const directorAlerts = q.data?.directorAlerts ?? [];
  const visible = approvalPage(pending, page);
  if (me.isLoading) return <Loading />;
  if (me.error) return <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">Your permissions could not be verified: {errMsg(me.error)}</div>;
  if (!isDirector && !isAdmin) return <div className="mx-auto max-w-lg rounded-xl border bg-card p-6"><ShieldCheck className="mb-3 h-7 w-7" /><h1 className="text-lg font-semibold">Restricted access</h1><p className="mt-2 text-sm text-muted-foreground">Only directors can vote. Administrators can prepare notification links without gaining voting rights.</p></div>;
  return <div className="mx-auto max-w-3xl pb-20">
    <PageHeader title="Director Approvals" subtitle={isAdmin && !isDirector ? "Share secure WhatsApp review links with all three directors." : "Review each request and approve using your own account. Three independent approvals are required."} />
    <div className="mb-5 rounded-xl border bg-card p-4 text-sm"><ShieldCheck className="mr-2 inline h-5 w-5 text-primary" />WhatsApp links only open the secured ERP page. Every director signs in with their own account. Sharing a link never approves a payment or PO.</div>
    {isAdmin && <div className="mb-5 rounded-xl border bg-card p-4 text-sm"><MessageCircle className="mr-2 inline h-5 w-5" />Manual notification mode: tapping WhatsApp opens a prefilled message; you must press Send yourself. Automatic WhatsApp sending will require the new business number and official API configuration. Create three Director accounts with their own phone numbers in <a href="/settings/users" className="font-semibold underline">Users & Roles</a>.</div>}
    {alertsUiEnabled && isAdmin && <div className="mb-5 rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold">Director WhatsApp opt-in & automatic alerts</h2>
      <p className="mt-1 text-xs text-muted-foreground">A queued alert is NOT sent. Meta-accepted is NOT delivered or read. The sender stays disabled until the business account and approved template are verified. Record genuine consent evidence before opting in.</p>
      {directors.map(d=>{
        const consent = directorConsents.find(c=>c.director_id===d.id);
        return <div key={d.id} className="mt-3 flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><strong>{d.full_name||"Director"}</strong><span>{consent?.status==="granted"?"Opted in":consent?.status==="revoked"?"Opted out":"No opt-in"} · {d.phone?"Phone configured":"Phone missing"}</span></div>
          <label className="text-xs text-muted-foreground" htmlFor={"wa-evidence-"+d.id}>Consent evidence / withdrawal reason (12+ characters)</label>
          <input id={"wa-evidence-"+d.id} className="min-h-11 rounded-lg border bg-background px-3 text-base sm:text-sm" maxLength={500}
            value={optInEvidence[d.id]??""} onChange={e=>setOptInEvidence(x=>({...x,[d.id]:e.target.value}))}
            placeholder="e.g. Director confirmed opt-in during recorded office discussion" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={consentAction.isPending||!d.phone} onClick={()=>consentAction.mutate({directorId:d.id,granted:true})}>Record opt-in</Button>
            <Button type="button" size="sm" variant="outline" disabled={consentAction.isPending} onClick={()=>consentAction.mutate({directorId:d.id,granted:false})}>Revoke opt-in</Button>
          </div>
        </div>;
      })}
    </div>}
    {q.isLoading ? <Loading /> : q.error ? <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">Director approvals could not be verified: {errMsg(q.error)} <Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button></div> : !pending.length ? <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">No pending approvals for this request. It may have been completed or cancelled.</div> :
    <div className="space-y-4">{visible.items.map(r => {
      const votes = votesByRequest.filter(v => v.entity_type === r.kind && v.entity_id === r.id);
      const approved = votes.filter(v => v.decision === "approved").length;
      const mine = votes.find(v => v.actor_id === me.data?.profile.id);
      const canVote = isDirector && !mine && r.createdBy !== me.data?.profile.id;
      return <section key={r.kind + r.id} className="rounded-xl border bg-card p-4 shadow-card sm:p-6">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.kind === "purchase_order" ? "Purchase order" : "Vendor payment"}</p><h2 className="mt-1 text-lg font-bold">{r.number}</h2></div><span className={"shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold " + (approved >= 3 ? "border-st-available/30 bg-st-available/10 text-st-available" : "border-st-hold/30 bg-st-hold/10 text-st-hold")}>{approved}/3 approved</span></div>
        <p className="num mt-3 text-2xl font-semibold text-foreground">{inr(r.amount)}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2"><div className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Project</dt><dd className="truncate font-medium">{r.project}</dd></div><div className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Vendor</dt><dd className="truncate font-medium">{r.vendor}</dd></div></dl>
        <div className="mt-4 grid grid-cols-3 gap-2">{[0,1,2].map(i => <div key={i} className={"rounded-lg border p-2 text-center text-xs font-medium " + (i < approved ? "border-st-available/30 bg-st-available/5 text-st-available" : "text-muted-foreground")}>{i < approved ? <CheckCircle2 aria-hidden className="mx-auto mb-1 h-5 w-5 text-st-available" /> : <Clock3 className="mx-auto mb-1 h-5 w-5 text-muted-foreground" />}{i < approved ? "Approved" : "Pending"}</div>)}</div>
        <a href={linkFor(r)} className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline">Review full details <ExternalLink className="h-3.5 w-3.5" /></a>
        {isAdmin && alertsUiEnabled && <div className="mt-4 rounded-xl border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-sm font-semibold">Automatic WhatsApp alerts</p>
              <p className="text-xs text-muted-foreground">Records are queued automatically for opted-in directors on submission; manual prepare also handles earlier documents.</p></div>
            <Button type="button" size="sm" variant="outline" disabled={prepareAction.isPending}
              onClick={()=>prepareAction.mutate(r)}>Prepare eligible alerts</Button>
          </div>
          <div className="mt-2 space-y-1 text-xs">{directors.map(d=>{
            const last = directorAlerts.find(n=>n.director_id===d.id&&n.entity_type===r.kind&&n.entity_id===r.id);
            return <p key={d.id}>{d.full_name||"Director"}: {last ? last.stage+" · "+(last.status==="accepted"?"Accepted by Meta (not delivery confirmed)":last.status) : "No queued alert"}</p>;
          })}</div>
        </div>}
        {isAdmin && <div className="mt-4 rounded-xl border p-3"><p className="mb-2 text-sm font-semibold">Notify each director on WhatsApp</p>{directors.length !== 3 && <p className="mb-2 text-xs text-destructive">Exactly three active director accounts are required. Found {directors.length}.</p>}{directors.length === 0 && <p className="text-xs text-muted-foreground">Invite directors under Users & Roles first.</p>}{directors.map(d => {
          const message = approvalMessage({ kind:r.kind, id:r.id, number:r.number, project:r.project, vendor:r.vendor, amount:r.amount }, window.location.origin);
          const wa = whatsappDraftUrl(d.phone ?? "", message);
          const already = votes.some(v => v.actor_id === d.id);
          return <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm"><span>{d.full_name || "Director"} <span className="text-xs text-muted-foreground">{already ? "· Voted" : d.phone ? "· Pending" : "· Phone missing"}</span></span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(message); toast.success("Approval message copied"); } catch { toast.error("Could not copy message"); } }}><Copy className="mr-1 h-4 w-4" />Copy</Button><Button size="sm" disabled={!wa || already} onClick={() => { if (wa) window.open(wa, "_blank", "noopener,noreferrer"); }}><MessageCircle className="mr-1 h-4 w-4" />WhatsApp</Button></div></div>;
        })}</div>}
        {isDirector && (mine ? <p className="mt-4 rounded-lg bg-muted p-3 text-sm">Your decision: {mine.decision} · {new Date(mine.created_at).toLocaleString()}</p> : !canVote ? <p className="mt-4 text-sm text-muted-foreground">You cannot approve a request you created.</p> :
        <div className="mt-4 space-y-3"><Textarea placeholder="Comment or rejection reason" value={reason[r.id] ?? ""} onChange={e => setReason(prev => ({ ...prev, [r.id]: e.target.value }))} /><div className="flex flex-col-reverse gap-3 sm:flex-row"><Button className="min-h-11 flex-1" disabled={action.isPending} onClick={() => { if (window.confirm(`Approve ${r.number} for ${inr(r.amount)}?`)) action.mutate({ request:r, decision:"approved" }); }}><CheckCircle2 className="mr-2 h-4 w-4" />Approve</Button>{r.kind === "purchase_order" && <Button className="min-h-11 flex-1" variant="outline" disabled={action.isPending || !(reason[r.id] ?? "").trim()} onClick={() => { if (window.confirm(`Reject ${r.number}?`)) action.mutate({ request:r, decision:"rejected" }); }}><XCircle className="mr-2 h-4 w-4" />Reject</Button>}</div></div>)}
      </section>;
    })}
    <Pager page={visible.page} total={visible.total} size={15} onPage={setPage} />
    </div>}
  </div>;
}
