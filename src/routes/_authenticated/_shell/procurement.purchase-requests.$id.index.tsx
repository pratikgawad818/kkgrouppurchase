import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Loading, PageHeader } from "@/components/erp/common";
import { errMsg, fmtDate, fmtDateTime, inr, num } from "@/lib/format";
import { useCan, useMe } from "@/lib/session";
import { RFQ_STATUS } from "@/lib/rfq";
import { PR_ACTION, PR_PRIORITY, PR_STATUS, PR_TYPE, type PrAction } from "@/lib/pr";

export const Route = createFileRoute("/_authenticated/_shell/procurement/purchase-requests/$id/")({
  head: () => ({ meta: [{ title: "Purchase Request — KK GROUP ERP" }, { name: "description", content: "Purchase request details, items and approval history." }, { property: "og:title", content: "Purchase Request — KK GROUP ERP" }, { property: "og:description", content: "Purchase request details, items and approval history." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: PrDetail,
});

const ACTION_COPY: Partial<Record<PrAction, { title: string; needs: boolean; variant?: "destructive" }>> = {
  approved: { title: "Approve request", needs: false },
  returned: { title: "Return for correction", needs: true },
  rejected: { title: "Reject request", needs: true, variant: "destructive" },
  cancelled: { title: "Cancel request", needs: false, variant: "destructive" },
};

function PrDetail() {
  const { id } = Route.useParams();
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const [act, setAct] = useState<PrAction | null>(null);
  const [comment, setComment] = useState("");

  const q = useQuery({
    queryKey: ["pr", id],
    queryFn: async () => {
      const [p, i, h] = await Promise.all([
        supabase.from("purchase_requests").select("*, projects(code,name), buildings(name), floors(name)").eq("id", id).single(),
        supabase.from("purchase_request_items").select("*, items(code,name), units_of_measure(code)").eq("purchase_request_id", id).order("line_no"),
        supabase.from("purchase_request_approvals").select("*").eq("purchase_request_id", id).order("acted_at"),
      ]);
      if (p.error) throw p.error;
      if (i.error) throw i.error;
      if (h.error) throw h.error;
      const ids = [...new Set([p.data.requested_by, ...(h.data ?? []).map((x) => x.acted_by)].filter(Boolean) as string[])];
      const { data: people } = await supabase.from("profiles").select("id,full_name,email").in("id", ids);
      const name = (uid: string | null) => { const x = people?.find((pp) => pp.id === uid); return x?.full_name ?? x?.email ?? "Staff member"; };
      return { pr: p.data, items: i.data ?? [], history: h.data ?? [], name };
    },
  });

  const rfqs = useQuery({
    queryKey: ["pr-rfqs", id],
    enabled: can("rfq.view"),
    queryFn: async () => { const { data, error } = await supabase.from("rfqs").select("id,rfq_number,status,rfq_vendors(status)").eq("purchase_request_id", id).order("created_at"); if (error) throw error; return data ?? []; },
  });

  const run = useMutation({
    mutationFn: async (a: PrAction) => {
      const { error } = await supabase.rpc("pr_transition", { _pr_id: id, _action: a, ...(comment.trim() ? { _comment: comment.trim() } : {}) });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Updated"); setAct(null); setComment(""); qc.invalidateQueries({ queryKey: ["pr", id] }); qc.invalidateQueries({ queryKey: ["prs"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="text-sm text-destructive">{errMsg(q.error)}</div>;
  const { pr, items, history, name } = q.data!;
  const mine = pr.requested_by === me.data?.profile.id;
  const st = PR_STATUS[pr.status];
  const pending = pr.status === "pending_approval";

  return (
    <>
      <PageHeader
        crumbs={<Link to="/procurement/purchase-requests">Purchase Requests</Link>}
        title={pr.pr_number}
        subtitle={<span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium font-medium ${st.cls}`}>{st.label}</span>}
        actions={<>
          {pr.status === "draft" && mine && can("purchase_request.edit") && <Button asChild size="sm" variant="outline"><Link to="/procurement/purchase-requests/$id/edit" params={{ id }}>Edit draft</Link></Button>}
          {pr.status === "draft" && mine && can("purchase_request.submit") && <Button size="sm" disabled={run.isPending} onClick={() => run.mutate("submitted")}>Submit for approval</Button>}
          {pending && !mine && can("purchase_request.approve") && <><Button size="sm" onClick={() => setAct("approved")}>Approve</Button><Button size="sm" variant="outline" onClick={() => setAct("returned")}>Return</Button></>}
          {pending && !mine && can("purchase_request.reject") && <Button size="sm" variant="outline" onClick={() => setAct("rejected")}>Reject</Button>}
          {pr.status === "approved" && can("rfq.create") && <Button asChild size="sm"><Link to="/procurement/rfqs/new" search={{ pr: id }}>Create RFQ</Link></Button>}
          {["draft", "pending_approval"].includes(pr.status) && can("purchase_request.cancel") && (mine || can("purchase_request.approve")) && <Button size="sm" variant="ghost" onClick={() => setAct("cancelled")}>Cancel PR</Button>}
        </>}
      />
      {pending && mine && <div className="mb-4 rounded-md border bg-card p-3 text-xs text-muted-foreground">Awaiting approval. You cannot approve your own request.</div>}

      <section className="rounded-md border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Request information</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Project">{pr.projects ? `${pr.projects.code} · ${pr.projects.name}` : null}</Field>
          <Field label="Building">{pr.buildings?.name}</Field>
          <Field label="Floor">{pr.floors?.name}</Field>
          <Field label="Requester">{name(pr.requested_by)}</Field>
          <Field label="Created">{fmtDate(pr.request_date)}</Field>
          <Field label="Required by">{fmtDate(pr.required_by)}</Field>
          <Field label="Priority">{PR_PRIORITY[pr.priority]}</Field>
          <Field label="Type">{PR_TYPE[pr.request_type]}</Field>
          <Field label="Purpose" className="sm:col-span-2">{pr.purpose}</Field>
          <Field label="Remarks" className="sm:col-span-2">{pr.remarks}</Field>
        </div>
      </section>

      <section className="mt-4 overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Material</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3">Unit</th><th className="px-4 py-3 text-right">Est. rate</th><th className="px-4 py-3 text-right">Est. amount</th><th className="px-4 py-3">Required by</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={7} className="p-3 text-xs text-muted-foreground">No items yet.</td></tr>}
            {items.map((x) => <tr key={x.id} className="border-b last:border-0 hover:bg-muted/40"><td className="px-4 py-3 text-muted-foreground">{x.line_no}</td><td className="px-4 py-3"><div>{x.items?.name}</div><div className="text-xs text-muted-foreground">{x.items?.code}{x.description ? ` · ${x.description}` : ""}</div></td><td className="px-4 py-3 text-right font-medium tabular-nums">{num(x.quantity)}</td><td className="px-4 py-3">{x.units_of_measure?.code}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{x.estimated_rate == null ? "—" : inr(x.estimated_rate)}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{inr(x.estimated_amount)}</td><td className="px-4 py-3">{fmtDate(x.required_by)}</td></tr>)}
          </tbody>
          <tfoot><tr className="border-t"><td colSpan={5} className="p-2 text-right text-xs text-muted-foreground">Estimated Value (not an accounting entry)</td><td className="px-4 py-3 text-right font-medium tabular-nums font-semibold">{inr(pr.estimated_total)}</td><td /></tr></tfoot>
        </table>
      </section>

      {rfqs.data && rfqs.data.length > 0 && (
        <section className="mt-4 rounded-md border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Linked RFQs</h2>
          <ul className="space-y-1 text-sm">{rfqs.data.map((r) => <li key={r.id}><Link className="font-mono text-primary hover:underline" to="/procurement/rfqs/$id" params={{ id: r.id }}>{r.rfq_number}</Link> <span className={`ml-2 inline-flex rounded-sm border px-1.5 text-[11px] ${RFQ_STATUS[r.status].cls}`}>{RFQ_STATUS[r.status].label}</span> <span className="ml-2 text-xs text-muted-foreground">{(r.rfq_vendors ?? []).filter((v) => v.status !== "pending").length}/{(r.rfq_vendors ?? []).length} responses</span></li>)}</ul>
        </section>
      )}

      <section className="mt-4 rounded-md border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Approval history</h2>
        <ol className="space-y-3 border-l pl-4">
          {history.map((x) => (
            <li key={x.id} className="relative text-sm">
              <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
              <div className="text-xs text-muted-foreground">{fmtDateTime(x.acted_at)}</div>
              <div><span className="font-medium">{PR_ACTION[x.action]}</span> by {name(x.acted_by)}</div>
              {x.comment && <div className="mt-0.5 text-xs italic text-muted-foreground">“{x.comment}”</div>}
            </li>
          ))}
        </ol>
      </section>

      <Dialog open={!!act} onOpenChange={(o) => !o && setAct(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{act && ACTION_COPY[act]?.title}</DialogTitle><DialogDescription>{act && ACTION_COPY[act]?.needs ? "A comment is required." : "Comment is optional."} It is recorded permanently in the approval history.</DialogDescription></DialogHeader>
          <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment" />
          <DialogFooter><Button variant="outline" onClick={() => setAct(null)}>Close</Button><Button variant={act ? ACTION_COPY[act]?.variant : undefined} disabled={run.isPending || (!!act && !!ACTION_COPY[act]?.needs && !comment.trim())} onClick={() => act && run.mutate(act)}>Confirm</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
