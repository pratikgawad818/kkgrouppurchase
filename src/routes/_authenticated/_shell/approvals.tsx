import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Clock3, Copy, ExternalLink, MessageCircle, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loading, PageHeader } from "@/components/erp/common";
import { errMsg, inr } from "@/lib/format";
import { approvalMessage, whatsappDraftUrl } from "@/lib/approval-notifications";

type Kind = "purchase_order" | "vendor_payment";
type Request = { id: string; kind: Kind; number: string; amount: number; status: string; projectId: string | null; project: string; vendor: string; createdBy: string };
type Vote = { entity_type: string; entity_id: string; actor_id: string; decision: string; created_at: string };
const linkFor = (request: Request) => request.kind === "purchase_order" ? `/procurement/purchase-orders/${request.id}` : "/finance/payments";

export const Route = createFileRoute("/_authenticated/_shell/approvals")({
  validateSearch: (s: Record<string, unknown>): { kind: Kind | null; id: string | null } => ({
    kind: s["kind"] === "purchase_order" || s["kind"] === "vendor_payment" ? s["kind"] : null,
    id: typeof s["id"] === "string" && /^[0-9a-f-]{36}$/i.test(s["id"]) ? s["id"] : null,
  }),
  component: DirectorApprovals,
  head: () => ({ meta: [{ title: "Director Approvals — KK GROUP ERP" }] }),
});

function DirectorApprovals() {
  const search = Route.useSearch();
  const me = useMe();
  const qc = useQueryClient();
  const [reason, setReason] = useState<Record<string, string>>({});
  const isDirector = me.data?.roles.includes("director") ?? false;
  const isAdmin = me.data?.permissions.has("users.manage") ?? false;
  const q = useQuery({
    queryKey: ["director-approvals", isAdmin, me.data?.profile.company_id],
    enabled: isDirector || isAdmin,
    queryFn: async () => {
      const [po, payments, votes] = await Promise.all([
        supabase.from("purchase_orders").select("id,po_number,grand_total,status,project_id,created_by,projects(name),vendors(company_name)").eq("status", "pending_approval").order("created_at", { ascending: false }).limit(200),
        supabase.from("vendor_payments").select("id,payment_number,amount,status,project_id,created_by,projects(name),vendors(company_name)").eq("status", "scheduled").order("created_at", { ascending: false }).limit(200),
        supabase.from("director_approval_votes").select("entity_type,entity_id,actor_id,decision,created_at").limit(2000),
      ]);
      if (po.error) throw po.error;
      if (payments.error) throw payments.error;
      if (votes.error) throw votes.error;
      const requests: Request[] = [
        ...(po.data ?? []).map(x => ({ id: x.id, kind: "purchase_order" as const, number: x.po_number, amount: Number(x.grand_total), status: x.status, projectId: x.project_id, project: x.projects?.name ?? "Project", vendor: x.vendors?.company_name ?? "Vendor", createdBy: x.created_by })),
        ...(payments.data ?? []).map(x => ({ id: x.id, kind: "vendor_payment" as const, number: x.payment_number, amount: Number(x.amount), status: x.status, projectId: x.project_id, project: x.projects?.name ?? "Company-wide", vendor: x.vendors?.company_name ?? "Vendor", createdBy: x.created_by })),
      ];
      let directors: { id: string; full_name: string | null; phone: string | null }[] = [];
      if (isAdmin && me.data?.profile.company_id) {
        const [p, roles] = await Promise.all([
          supabase.from("profiles").select("id,full_name,phone,is_active").eq("company_id", me.data.profile.company_id).eq("is_active", true),
          supabase.from("user_roles").select("user_id").eq("role", "director"),
        ]);
        if (p.error) throw p.error;
        if (roles.error) throw roles.error;
        const directorIds = new Set((roles.data ?? []).map(r => r.user_id));
        directors = (p.data ?? []).filter(x => directorIds.has(x.id));
      }
      return { requests, votes: (votes.data ?? []) as Vote[], directors };
    },
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
  if (me.isLoading) return <Loading />;
  if (!isDirector && !isAdmin) return <div className="mx-auto max-w-lg rounded-xl border bg-card p-6"><ShieldCheck className="mb-3 h-7 w-7" /><h1 className="text-lg font-semibold">Restricted access</h1><p className="mt-2 text-sm text-muted-foreground">Only directors can vote. Administrators can prepare notification links without gaining voting rights.</p></div>;
  return <div className="mx-auto max-w-3xl pb-20">
    <PageHeader title="Director Approvals" subtitle={isAdmin && !isDirector ? "Share secure WhatsApp review links with all three directors." : "Review each request and approve using your own account. Three independent approvals are required."} />
    <div className="mb-5 rounded-xl border bg-card p-4 text-sm"><ShieldCheck className="mr-2 inline h-5 w-5 text-primary" />WhatsApp links only open the secured ERP page. Every director signs in with their own account. Sharing a link never approves a payment or PO.</div>
    {isAdmin && <div className="mb-5 rounded-xl border bg-card p-4 text-sm"><MessageCircle className="mr-2 inline h-5 w-5" />Manual notification mode: tapping WhatsApp opens a prefilled message; you must press Send yourself. Automatic WhatsApp sending will require the new business number and official API configuration. Create three Director accounts with their own phone numbers in <a href="/settings/users" className="font-semibold underline">Users & Roles</a>.</div>}
    {q.isLoading ? <Loading /> : q.error ? <p className="text-sm text-destructive">{errMsg(q.error)}</p> : !q.data?.requests.filter(r => !search.id || (r.id === search.id && r.kind === search.kind)).length ? <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">No pending approvals for this request. It may have been completed or cancelled.</div> :
    <div className="space-y-4">{q.data.requests.filter(r => !search.id || (r.id === search.id && r.kind === search.kind)).map(r => {
      const votes = q.data.votes.filter(v => v.entity_type === r.kind && v.entity_id === r.id);
      const approved = votes.filter(v => v.decision === "approved").length;
      const mine = votes.find(v => v.actor_id === me.data?.profile.id);
      const canVote = isDirector && !mine && r.createdBy !== me.data?.profile.id;
      return <section key={r.kind + r.id} className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.kind === "purchase_order" ? "Purchase order" : "Vendor payment"}</p><h2 className="mt-1 text-lg font-bold">{r.number}</h2></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{approved}/3 approved</span></div>
        <p className="mt-3 text-2xl font-bold tabular-nums">{inr(r.amount)}</p>
        <div className="mt-3 space-y-1 text-sm text-muted-foreground"><p>Project: {r.project}</p><p>Vendor: {r.vendor}</p></div>
        <div className="mt-4 grid grid-cols-3 gap-2">{[0,1,2].map(i => <div key={i} className="rounded-lg border p-2 text-center text-xs">{i < approved ? <CheckCircle2 className="mx-auto mb-1 h-5 w-5 text-green-600" /> : <Clock3 className="mx-auto mb-1 h-5 w-5 text-muted-foreground" />}{i < approved ? "Approved" : "Pending"}</div>)}</div>
        <a href={linkFor(r)} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">Review full details <ExternalLink className="h-3.5 w-3.5" /></a>
        {isAdmin && <div className="mt-4 rounded-xl border p-3"><p className="mb-2 text-sm font-semibold">Notify each director on WhatsApp</p>{q.data.directors.length !== 3 && <p className="mb-2 text-xs text-destructive">Exactly three active director accounts are required. Found {q.data.directors.length}.</p>}{q.data.directors.length === 0 && <p className="text-xs text-muted-foreground">Invite directors under Users & Roles first.</p>}{q.data.directors.map(d => {
          const message = approvalMessage({ kind:r.kind, id:r.id, number:r.number, project:r.project, vendor:r.vendor, amount:r.amount }, window.location.origin);
          const wa = whatsappDraftUrl(d.phone ?? "", message);
          const already = votes.some(v => v.actor_id === d.id);
          return <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm"><span>{d.full_name || "Director"} <span className="text-xs text-muted-foreground">{already ? "· Voted" : d.phone ? "· Pending" : "· Phone missing"}</span></span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(message); toast.success("Approval message copied"); } catch { toast.error("Could not copy message"); } }}><Copy className="mr-1 h-4 w-4" />Copy</Button><Button size="sm" disabled={!wa || already} onClick={() => { if (wa) window.open(wa, "_blank", "noopener,noreferrer"); }}><MessageCircle className="mr-1 h-4 w-4" />WhatsApp</Button></div></div>;
        })}</div>}
        {isDirector && (mine ? <p className="mt-4 rounded-lg bg-muted p-3 text-sm">Your decision: {mine.decision} · {new Date(mine.created_at).toLocaleString()}</p> : !canVote ? <p className="mt-4 text-sm text-muted-foreground">You cannot approve a request you created.</p> :
        <div className="mt-4 space-y-3"><Textarea placeholder="Comment or rejection reason" value={reason[r.id] ?? ""} onChange={e => setReason(prev => ({ ...prev, [r.id]: e.target.value }))} /><div className="flex gap-2"><Button className="min-h-11 flex-1" disabled={action.isPending} onClick={() => { if (window.confirm(`Approve ${r.number} for ${inr(r.amount)}?`)) action.mutate({ request:r, decision:"approved" }); }}><CheckCircle2 className="mr-2 h-4 w-4" />Approve</Button>{r.kind === "purchase_order" && <Button className="min-h-11 flex-1" variant="outline" disabled={action.isPending || !(reason[r.id] ?? "").trim()} onClick={() => { if (window.confirm(`Reject ${r.number}?`)) action.mutate({ request:r, decision:"rejected" }); }}><XCircle className="mr-2 h-4 w-4" />Reject</Button>}</div></div>)}
      </section>;
    })}</div>}
  </div>;
}
