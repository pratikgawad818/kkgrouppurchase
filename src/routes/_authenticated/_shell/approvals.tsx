import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, ExternalLink, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadCompleteRows } from "@/lib/complete-register";
import { approvalPage, pendingApprovals, voteFetchChunks } from "@/lib/approval-queue";
import { useMe } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loading, PageHeader } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { ApprovalKindTabs } from "@/components/erp/approval-kind-tabs";
import { errMsg, inr } from "@/lib/format";

type Kind = "purchase_order" | "vendor_payment";
type Request = { id: string; kind: Kind; number: string; amount: number; status: string; projectId: string | null; project: string; vendor: string; createdBy: string };
type Vote = { entity_type: string; entity_id: string; actor_id: string; decision: string; created_at: string };
const linkFor = (request: Request) => request.kind === "purchase_order" ? `/procurement/purchase-orders/${request.id}` : "/finance/payments";

export const Route = createFileRoute("/_authenticated/_shell/approvals")({
  validateSearch: (s: Record<string, unknown>): { kind: Kind | null; id: string | null } => {
    return {
      kind: (s["kind"] === "purchase_order" || s["kind"] === "vendor_payment" ? s["kind"] : null),
      id: (typeof s["id"] === "string" && /^[0-9a-f-]{36}$/i.test(s["id"]) ? s["id"] : null),
    };
  },
  component: DirectorApprovals,
  head: () => ({ meta: [{ title: "Director Approvals — KK GROUP ERP" }] }),
});

function DirectorApprovals() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const activeKind = search.kind ?? "purchase_order";
  const me = useMe();
  const qc = useQueryClient();
  const [reason, setReason] = useState<Record<string, string>>({});
  const [pagination, setPagination] = useState({ kind: activeKind, id: search.id, page: 0 });
  const page = pagination.kind === activeKind && pagination.id === search.id ? pagination.page : 0;
  const setPage = (next: number) => setPagination({ kind: activeKind, id: search.id, page: next });
  const selectKind = (kind: Kind) => {
    setPagination({ kind, id: null, page: 0 });
    void navigate({ search: { kind, id: null } });
  };
  const isDirector = me.data?.roles.includes("director") ?? false;
  const isAdmin = me.data?.permissions.has("users.manage") ?? false;
  const q = useQuery({
    queryKey: ["director-approvals", isAdmin, me.data?.profile.company_id],
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
      let directors: { id: string; full_name: string | null }[] = [];
      const companyId = me.data?.profile.company_id;
      if (isAdmin && companyId) {
        const [profiles, roles] = await Promise.all([
          loadCompleteRows(async (start, end) => await supabase.from("profiles")
            .select("id,full_name,is_active", { count: "exact" })
            .eq("company_id", companyId).eq("is_active", true).order("id").range(start, end)),
          loadCompleteRows(async (start, end) => await supabase.from("user_roles")
            .select("id,user_id", { count: "exact" }).eq("role", "director").order("id").range(start, end)),
        ]);
        const directorIds = new Set(roles.map(r => r.user_id));
        directors = profiles.filter(x => directorIds.has(x.id));
      }
      return { requests, votes, directors };
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
  const requests = q.data?.requests ?? [];
  const pending = pendingApprovals(requests, activeKind, search.id);
  const counts = q.data ? {
    purchase_order: pendingApprovals(requests, "purchase_order").length,
    vendor_payment: pendingApprovals(requests, "vendor_payment").length,
  } : undefined;
  const votesByRequest = q.data?.votes ?? [];
  const directors = q.data?.directors ?? [];
  const visible = approvalPage(pending, page);
  if (me.isLoading) return <Loading />;
  if (me.error) return <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">Your permissions could not be verified: {errMsg(me.error)}</div>;
  if (!isDirector && !isAdmin) return <div className="mx-auto max-w-lg rounded-xl border bg-card p-6"><ShieldCheck className="mb-3 h-7 w-7" /><h1 className="text-lg font-semibold">Restricted access</h1><p className="mt-2 text-sm text-muted-foreground">Only directors can vote. Administrators can review the queue without gaining voting rights.</p></div>;
  return <div className="mx-auto max-w-3xl pb-20">
    <PageHeader title="Director Approvals" subtitle={isAdmin && !isDirector ? "Monitor requests and each director’s recorded decision." : "Review each request and approve using your own account. Three independent approvals are required."} />
    <ApprovalKindTabs value={activeKind} counts={counts} onChange={selectKind} />
    <div className="mb-5 rounded-xl border bg-card p-4 text-sm"><ShieldCheck className="mr-2 inline h-5 w-5 text-primary" />Each director signs in with their own account. Every decision is recorded in the app.</div>
    {isAdmin && directors.length === 0 && <div role="status" className="mb-5 rounded-xl border bg-card p-4 text-sm">At least one active director account is required. Found 0. Review accounts in <a href="/settings/users" className="font-semibold underline">Users & Roles</a>.</div>}
    <div id="approval-queue-panel" role="tabpanel" aria-labelledby={`approval-tab-${activeKind}`} tabIndex={0}>
    {q.isLoading ? <Loading /> : q.error ? <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">Director approvals could not be verified: {errMsg(q.error)} <Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button></div> : !pending.length ? <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">{search.id ? "No pending approval for this request. It may have been completed or cancelled." : activeKind === "purchase_order" ? "No purchase orders awaiting approval." : "No vendor payments awaiting approval."}{search.id && <Button variant="outline" size="sm" className="mt-3" onClick={() => selectKind(activeKind)}>Show all {activeKind === "purchase_order" ? "purchase orders" : "vendor payments"}</Button>}</div> :
    <div className="space-y-4">{visible.items.map(r => {
      const votes = votesByRequest.filter(v => v.entity_type === r.kind && v.entity_id === r.id);
      const approved = votes.filter(v => v.decision === "approved").length;
      const mine = votes.find(v => v.actor_id === me.data?.profile.id);
      const canVote = isDirector && !mine && r.createdBy !== me.data?.profile.id;
      return <section key={r.kind + r.id} className="rounded-xl border bg-card p-4 shadow-card sm:p-6">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.kind === "purchase_order" ? "Purchase order" : "Vendor payment"}</p><h2 className="mt-1 text-lg font-bold">{r.number}</h2></div><span className={"shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold " + (approved >= 1 ? "border-st-available/30 bg-st-available/10 text-st-available" : "border-st-hold/30 bg-st-hold/10 text-st-hold")}>{approved >= 1 ? "Approved" : "Awaiting 1 of 3 directors"}</span></div>
        <p className="num mt-3 text-2xl font-semibold text-foreground">{inr(r.amount)}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2"><div className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Project</dt><dd className="truncate font-medium">{r.project}</dd></div><div className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Vendor</dt><dd className="truncate font-medium">{r.vendor}</dd></div></dl>
        
        <a href={linkFor(r)} className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline">Review full details <ExternalLink className="h-3.5 w-3.5" /></a>
        {isAdmin && directors.length > 0 && <div className="mt-4 rounded-xl border p-3">
          <h3 className="mb-2 text-sm font-semibold">Director decisions</h3>
          {directors.map(d => {
            const vote = votes.find(v => v.actor_id === d.id);
            return <p key={d.id} className="border-t py-2 text-sm">{d.full_name || "Director"} · {vote?.decision ?? "Pending"}</p>;
          })}
        </div>}
        {isDirector && (mine ? <p className="mt-4 rounded-lg bg-muted p-3 text-sm">Your decision: {mine.decision} · {new Date(mine.created_at).toLocaleString()}</p> : !canVote ? <p className="mt-4 text-sm text-muted-foreground">You cannot approve a request you created.</p> :
        <div className="mt-4 space-y-3"><Textarea placeholder="Comment or rejection reason" value={reason[r.id] ?? ""} onChange={e => setReason(prev => ({ ...prev, [r.id]: e.target.value }))} /><div className="flex flex-col-reverse gap-3 sm:flex-row"><Button className="min-h-11 flex-1" disabled={action.isPending} onClick={() => { if (window.confirm(`Approve ${r.number} for ${inr(r.amount)}?`)) action.mutate({ request:r, decision:"approved" }); }}><CheckCircle2 className="mr-2 h-4 w-4" />Approve</Button>{r.kind === "purchase_order" && <Button className="min-h-11 flex-1" variant="outline" disabled={action.isPending || !(reason[r.id] ?? "").trim()} onClick={() => { if (window.confirm(`Reject ${r.number}?`)) action.mutate({ request:r, decision:"rejected" }); }}><XCircle className="mr-2 h-4 w-4" />Reject</Button>}</div></div>)}
      </section>;
    })}
    <Pager page={visible.page} total={visible.total} size={15} onPage={setPage} />
    </div>}
    </div>
  </div>;
}
