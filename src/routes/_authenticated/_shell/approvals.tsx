import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Clock3, ExternalLink, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loading, PageHeader } from "@/components/erp/common";
import { errMsg, inr } from "@/lib/format";

type Kind = "purchase_order" | "vendor_payment";
type Request = { id: string; kind: Kind; number: string; amount: number; status: string; projectId: string | null; project: string; vendor: string; createdBy: string };
type Vote = { entity_type: string; entity_id: string; actor_id: string; decision: string; created_at: string };
const linkFor = (request: Request) => request.kind === "purchase_order" ? `/procurement/purchase-orders/${request.id}` : "/finance/payments";

export const Route = createFileRoute("/_authenticated/_shell/approvals")({
  component: DirectorApprovals,
  head: () => ({ meta: [{ title: "Director Approvals — KK GROUP ERP" }] }),
});

function DirectorApprovals() {
  const me = useMe();
  const qc = useQueryClient();
  const [reason, setReason] = useState<Record<string, string>>({});
  const isDirector = me.data?.roles.includes("director") ?? false;
  const q = useQuery({
    queryKey: ["director-approvals"],
    enabled: isDirector,
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
      return { requests, votes: (votes.data ?? []) as Vote[] };
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
  if (!isDirector) return <div className="mx-auto max-w-lg rounded-xl border bg-card p-6"><ShieldCheck className="mb-3 h-7 w-7" /><h1 className="text-lg font-semibold">Director access required</h1><p className="mt-2 text-sm text-muted-foreground">Sign in with a director account to review and approve requests. Administrator access alone does not grant voting rights.</p></div>;
  return <div className="mx-auto max-w-3xl pb-20">
    <PageHeader title="Director Approvals" subtitle="Review each request and approve using your own account. Three independent approvals are required." />
    <div className="mb-5 rounded-xl border bg-card p-4 text-sm"><ShieldCheck className="mr-2 inline h-5 w-5 text-primary" />Your vote is tied to your authenticated director account. WhatsApp links are notifications, not approval credentials.</div>
    {q.isLoading ? <Loading /> : q.error ? <p className="text-sm text-destructive">{errMsg(q.error)}</p> : !q.data?.requests.length ? <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">No pending approvals.</div> :
    <div className="space-y-4">{q.data.requests.map(r => {
      const votes = q.data.votes.filter(v => v.entity_type === r.kind && v.entity_id === r.id);
      const approved = votes.filter(v => v.decision === "approved").length;
      const mine = votes.find(v => v.actor_id === me.data?.profile.id);
      const canVote = !mine && r.createdBy !== me.data?.profile.id;
      return <section key={r.kind + r.id} className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.kind === "purchase_order" ? "Purchase order" : "Vendor payment"}</p><h2 className="mt-1 text-lg font-bold">{r.number}</h2></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{approved}/3 approved</span></div>
        <p className="mt-3 text-2xl font-bold tabular-nums">{inr(r.amount)}</p>
        <div className="mt-3 space-y-1 text-sm text-muted-foreground"><p>Project: {r.project}</p><p>Vendor: {r.vendor}</p></div>
        <div className="mt-4 grid grid-cols-3 gap-2">{[0,1,2].map(i => <div key={i} className="rounded-lg border p-2 text-center text-xs">{i < approved ? <CheckCircle2 className="mx-auto mb-1 h-5 w-5 text-green-600" /> : <Clock3 className="mx-auto mb-1 h-5 w-5 text-muted-foreground" />}{i < approved ? "Approved" : "Pending"}</div>)}</div>
        <a href={linkFor(r)} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">Review full details <ExternalLink className="h-3.5 w-3.5" /></a>
        {mine ? <p className="mt-4 rounded-lg bg-muted p-3 text-sm">Your decision: {mine.decision} · {new Date(mine.created_at).toLocaleString()}</p> : !canVote ? <p className="mt-4 text-sm text-muted-foreground">You cannot approve a request you created.</p> :
        <div className="mt-4 space-y-3"><Textarea placeholder="Comment or rejection reason" value={reason[r.id] ?? ""} onChange={e => setReason(prev => ({ ...prev, [r.id]: e.target.value }))} /><div className="flex gap-2"><Button className="min-h-11 flex-1" disabled={action.isPending} onClick={() => action.mutate({ request:r, decision:"approved" })}><CheckCircle2 className="mr-2 h-4 w-4" />Approve</Button>{r.kind === "purchase_order" && <Button className="min-h-11 flex-1" variant="outline" disabled={action.isPending || !(reason[r.id] ?? "").trim()} onClick={() => action.mutate({ request:r, decision:"rejected" })}><XCircle className="mr-2 h-4 w-4" />Reject</Button>}</div></div>}
      </section>;
    })}</div>}
  </div>;
}
