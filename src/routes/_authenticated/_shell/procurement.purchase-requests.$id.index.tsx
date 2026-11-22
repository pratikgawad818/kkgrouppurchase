import { PermanentDelete } from "@/components/erp/permanent-delete";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { documentActorNames } from "@/lib/document-actors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Loading, PageHeader } from "@/components/erp/common";
import { ProcurementAttachmentLink } from "@/components/erp/procurement-attachment";
import { PrMissingAttachment } from "@/components/erp/pr-missing-attachment";
import { WorkflowTimeline } from "@/components/erp/workflow-timeline";
import { ProcurementRevisionHistory } from "@/components/erp/procurement-revision-history";
import { errMsg, fmtDate, fmtDateTime, num } from "@/lib/format";
import { directorCanFinalizeOwnPurchasing } from "@/lib/purchasing-authority";
import { useCan, useMe } from "@/lib/session";
import { RFQ_STATUS } from "@/lib/rfq";
import { PR_PRIORITY, PR_STATUS, PR_TYPE, type PrAction } from "@/lib/pr";

export const Route = createFileRoute("/_authenticated/_shell/procurement/purchase-requests/$id/")({
  head: () => ({
    meta: [
      { title: "Purchase Request — KK GROUP ERP" },
      { name: "description", content: "Purchase request details, items and approval history." },
      { property: "og:title", content: "Purchase Request — KK GROUP ERP" },
      {
        property: "og:description",
        content: "Purchase request details, items and approval history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrDetail,
});

type SelectedSupplierQuotation = {
  po_id: string;
  po_number: string;
  vendor_name: string | null;
  quotation_number: string | null;
  attachment_path: string | null;
};

const ACTION_COPY: Partial<
  Record<PrAction, { title: string; needs: boolean; variant?: "destructive" }>
> = {
  approved: { title: "Receive request for procurement", needs: false },
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
  const [correctionResponses, setCorrectionResponses] = useState<Record<string,string>>({});

  const q = useQuery({
    queryKey: ["pr", id],
    queryFn: async () => {
      const [p, i, h] = await Promise.all([
        supabase
          .from("purchase_requests")
          .select("*, projects(code,name), buildings(name), floors(name)")
          .eq("id", id)
          .single(),
        supabase
          .from("purchase_request_items")
          .select("*, items(code,name), units_of_measure(code)")
          .eq("purchase_request_id", id)
          .order("line_no"),
        supabase
          .from("purchase_request_approvals")
          .select("*")
          .eq("purchase_request_id", id)
          .order("acted_at"),
      ]);
      if (p.error) throw p.error;
      if (i.error) throw i.error;
      if (h.error) throw h.error;
      const people = await documentActorNames("purchase_request", [id]);
      const name = (uid: string | null) =>
        (uid ? people.get(uid) : null) ?? "Staff name unavailable";
      return { pr: p.data, items: i.data ?? [], history: h.data ?? [], name };
    },
  });

  const rfqs = useQuery({
    queryKey: ["pr-rfqs", id],
    enabled: can("rfq.view"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rfqs")
        .select("id,rfq_number,status,rfq_vendors(status)")
        .eq("purchase_request_id", id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const selectedQuotations = useQuery({
    queryKey: ["pr-selected-supplier-quotations", id],
    enabled: can("purchase_request.view") && can("purchase_order.view"),
    staleTime: 30_000,
    refetchOnMount: "always",
    queryFn: async (): Promise<SelectedSupplierQuotation[]> => {
      // The PR's own attachment and the supplier's selected PO quotation are
      // stored separately. The read-only RPC performs both project/company
      // and document-permission checks; it exposes no competing vendor bids.
      const { data, error } = await supabase.rpc(
        "get_pr_selected_supplier_quotes" as never,
        { _pr_id: id } as never,
      );
      if (error) throw error;
      return (data ?? []) as SelectedSupplierQuotation[];
    },
  });

  const siteCorrections = useQuery({
    queryKey: ["pr-site-corrections", id],
    queryFn: async () => {
      // Table introduced in migration 0079; permissions remain project scoped.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("po_site_correction_requests")
        .select("id,po_id,assigned_to,created_at,reason,response,status,responded_at")
        .eq("purchase_request_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as {
        id:string;po_id:string;assigned_to:string;created_at:string;reason:string;
        response:string|null;status:"requested"|"responded"|"resolved";responded_at:string|null;
      }[];
    },
  });
  const respondToSiteCorrection = useMutation({
    mutationFn: async (ticketId:string) => {
      const response = correctionResponses[ticketId]?.trim() ?? "";
      if (response.length < 10) throw new Error("Explain the correction in at least 10 characters.");
      const { error } = await supabase.rpc("respond_po_site_correction" as never, {
        _correction_id: ticketId, _response: response,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Your correction response has been sent to the Purchase Manager");
      setCorrectionResponses({});
      void qc.invalidateQueries({ queryKey: ["pr-site-corrections", id] });
      void qc.invalidateQueries({ queryKey: ["po"] });
    },
    onError: (error) => toast.error(errMsg(error)),
  });

  const run = useMutation({
    mutationFn: async (a: PrAction) => {
      const { error } = await supabase.rpc("pr_transition", {
        _pr_id: id,
        _action: a,
        ...(comment.trim() ? { _comment: comment.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: (_data, action) => {
      toast.success(action === "approved"
        ? (me.data?.roles.includes("purchase_manager")
          ? "Purchase Manager received your request"
          : "Request accepted for procurement")
        : "Updated");
      setAct(null);
      setComment("");
      qc.invalidateQueries({ queryKey: ["pr", id] });
      qc.invalidateQueries({ queryKey: ["prs"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="text-sm text-destructive">{errMsg(q.error)}</div>;
  const { pr, items, history, name } = q.data!;
  const mine = pr.requested_by === me.data?.profile.id;
  const st = PR_STATUS[pr.status];
  const pending = pr.status === "pending_approval";
  const finalizeOwn = mine && directorCanFinalizeOwnPurchasing(me.data?.roles ?? []);

  return (
    <>
      <PageHeader deleteAction={<PermanentDelete force kind="purchase_request" id={pr.id} name={pr.pr_number} onDeleted={()=>window.location.assign("/procurement/purchase-requests")}/>}
        crumbs={<Link to="/procurement/purchase-requests">Purchase Requests</Link>}
        title={pr.pr_number}
        subtitle={
          <span
            className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium font-medium ${st.cls}`}
          >
            {st.label}
          </span>
        }
        actions={
          <>
            {pr.status === "draft" && mine && can("purchase_request.edit") && (
              <Button asChild size="sm" variant="outline">
                <Link to="/procurement/purchase-requests/$id/edit" params={{ id }}>
                  Edit / correct PR
                </Link>
              </Button>
            )}
            {(pr.status === "draft" || (pending && finalizeOwn)) &&
              mine &&
              can("purchase_request.submit") && (
                <Button size="sm" disabled={run.isPending} onClick={() => run.mutate("submitted")}>
                  {finalizeOwn ? "Finalize request" : "Submit for approval"}
                </Button>
              )}
            {pending && !mine && can("purchase_request.approve") && (
              <>
                <Button size="sm" onClick={() => setAct("approved")}>
                  {me.data?.roles.includes("purchase_manager") ? "Receive request" : "Accept for procurement"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAct("returned")}>
                  Return
                </Button>
              </>
            )}
            {pending && !mine && can("purchase_request.reject") && (
              <Button size="sm" variant="outline" onClick={() => setAct("rejected")}>
                Reject
              </Button>
            )}
            {pr.status === "approved" && can("rfq.create") && (
              <Button asChild size="sm">
                <Link to="/procurement/rfqs/new" search={{ pr: id }}>
                  Create RFQ
                </Link>
              </Button>
            )}
            {["draft", "pending_approval"].includes(pr.status) &&
              can("purchase_request.cancel") &&
              (mine || can("purchase_request.approve")) && (
                <Button size="sm" variant="ghost" onClick={() => setAct("cancelled")}>
                  Cancel PR
                </Button>
              )}
          </>
        }
      />
      {can("purchase_order.view") && (
        <section className="mb-4 rounded-xl border border-primary/20 bg-card p-4 shadow-sm" aria-label="Supplier quotations linked to this purchase request">
          <div className="mb-3">
            <h2 className="text-sm font-semibold">Supplier quotation — linked to your purchase request</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The selected supplier quotation is attached to the linked PO. View the original PDF here.
            </p>
          </div>
          {selectedQuotations.isPending && (
            <p role="status" className="text-xs text-muted-foreground">Loading linked quotations…</p>
          )}
          {selectedQuotations.isSuccess && selectedQuotations.data.length > 0 && (
            <p role="status" className="mb-3 text-xs font-medium text-primary">
              {selectedQuotations.data.length} purchase order{selectedQuotations.data.length === 1 ? "" : "s"} linked
            </p>
          )}
          {selectedQuotations.isError && (
            <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-3">
              <p className="break-words text-xs text-destructive">
                Linked quotations could not be loaded: {errMsg(selectedQuotations.error)}
              </p>
              <Button variant="outline" size="sm" onClick={() => void selectedQuotations.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {selectedQuotations.isSuccess && selectedQuotations.data.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No supplier quotation has been selected for a linked purchase order yet.
              Quotations being collected in an RFQ are not automatically attached to this PR.
            </p>
          )}
          {selectedQuotations.data?.length ? (
            <ul className="space-y-2">
              {selectedQuotations.data.map((quote) => (
                <li key={quote.po_id} className="min-w-0 rounded-lg border p-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        to="/procurement/purchase-orders/$id"
                        params={{ id: quote.po_id }}
                        className="break-all text-sm font-semibold text-primary hover:underline"
                      >
                        {quote.po_number}
                      </Link>
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {quote.vendor_name ?? "Supplier not recorded"}
                        {quote.quotation_number ? " · " + quote.quotation_number : ""}
                      </p>
                    </div>
                    {quote.attachment_path ? (
                      <ProcurementAttachmentLink
                        path={quote.attachment_path}
                        label="View quotation"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No quotation PDF / image attached
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}

      {pending && mine && (
        <div className="mb-4 rounded-md border bg-card p-3 text-xs text-muted-foreground">
          Awaiting approval. You cannot approve your own request.
        </div>
      )}
      {(siteCorrections.data?.length ?? 0) > 0 && (
        <section className="mb-4 space-y-3 rounded-xl border bg-card p-4" aria-label="Site Engineer correction requests">
          <h2 className="text-sm font-semibold">Linked PO correction requests</h2>
          <p className="text-xs text-muted-foreground">
            The Purchase Manager has returned a question about this original request.
            Your reply goes directly to the Purchase Manager for PO reconciliation.
            The approved source request and awarded supplier quotation remain unchanged
            until an authorised procurement amendment is made.
          </p>
          {siteCorrections.data!.map((ticket) => (
            <div key={ticket.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap justify-between gap-2 text-xs font-medium">
                <span>{ticket.status === "requested" ? "Response required" :
                  ticket.status === "responded" ? "Response submitted" : "Resolved by Purchase Manager"}</span>
                <time dateTime={ticket.created_at} className="text-muted-foreground">
                  {fmtDateTime(ticket.created_at)}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">{ticket.reason}</p>
              {ticket.response && <p className="mt-2 rounded-md bg-muted/40 p-3 text-sm">
                Your response: {ticket.response}
              </p>}
              {ticket.status === "requested" && ticket.assigned_to === me.data?.profile.id && (
                <div className="mt-3 space-y-2">
                  <label htmlFor={`site-correction-${ticket.id}`} className="text-xs font-semibold">
                    Site Engineer's correction / explanation *
                  </label>
                  <Textarea id={`site-correction-${ticket.id}`} rows={3} maxLength={4000}
                    placeholder="Confirm the correct material quantity, specifications, site requirement and any supporting explanation…"
                    value={correctionResponses[ticket.id] ?? ""}
                    onChange={(e) => setCorrectionResponses((old) => ({ ...old, [ticket.id]: e.target.value }))} />
                  <Button size="sm" disabled={respondToSiteCorrection.isPending ||
                    (correctionResponses[ticket.id]?.trim().length ?? 0) < 10}
                    onClick={() => respondToSiteCorrection.mutate(ticket.id)}>
                    {respondToSiteCorrection.isPending ? "Sending…" : "Send correction to Purchase Manager"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      {siteCorrections.error && (
        <p role="alert" className="mb-4 rounded-lg border border-destructive/30 p-3 text-xs text-destructive">
          Correction requests could not be loaded: {errMsg(siteCorrections.error)}
        </p>
      )}

      <section className="rounded-md border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Request information</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Project">{pr.projects ? pr.projects.name : null}</Field>
          <Field label="Building">{pr.buildings?.name}</Field>
          <Field label="Floor">{pr.floors?.name}</Field>
          <Field label="Requester">{name(pr.requested_by)}</Field>
          <Field label="Created">{fmtDate(pr.request_date)}</Field>
          <Field label="Required by">{fmtDate(pr.required_by)}</Field>
          <Field label="Priority">{PR_PRIORITY[pr.priority]}</Field>
          <Field label="Type">{PR_TYPE[pr.request_type]}</Field>
          <Field label="Purpose" className="sm:col-span-2">
            {pr.purpose}
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            {pr.remarks}
          </Field>
        </div>
      </section>

      {pr.attachment_path && (
        <section className="mt-4 rounded-md border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Document attached to this purchase request</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Original PDF or image uploaded with this request. Supplier quotations selected for purchase orders appear separately below.
          </p>
          <ProcurementAttachmentLink path={pr.attachment_path}
            label="View attached PDF / photo" />
        </section>
      )}
      {!pr.attachment_path && pending && mine && can("purchase_request.edit") && (
        <PrMissingAttachment
          prId={pr.id}
          companyId={me.data?.profile.company_id ?? ""}
          actorId={me.data?.profile.id ?? ""}
          onLinked={() => {
            void qc.invalidateQueries({ queryKey: ["pr", id] });
          }}
        />
      )}
      <section className="mt-4 overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Material</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3">Required by</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="p-3 text-xs text-muted-foreground">
                  No items yet.
                </td>
              </tr>
            )}
            {items.map((x) => (
              <tr key={x.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="px-4 py-3 text-muted-foreground">{x.line_no}</td>
                <td className="px-4 py-3">
                  <div>{x.items?.name}</div>
                  <div className="text-xs text-muted-foreground">{x.description ?? ""}</div>
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{num(x.quantity)}</td>
                <td className="px-4 py-3">{x.units_of_measure?.code}</td>
                <td className="px-4 py-3">{fmtDate(x.required_by)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {rfqs.data && rfqs.data.length > 0 && (
        <section className="mt-4 rounded-md border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Linked RFQs</h2>
          <ul className="space-y-1 text-sm">
            {rfqs.data.map((r) => (
              <li key={r.id}>
                <Link
                  className="font-mono text-primary hover:underline"
                  to="/procurement/rfqs/$id"
                  params={{ id: r.id }}
                >
                  {r.rfq_number}
                </Link>{" "}
                <span
                  className={`ml-2 inline-flex rounded-sm border px-1.5 text-[11px] ${RFQ_STATUS[r.status].cls}`}
                >
                  {RFQ_STATUS[r.status].label}
                </span>{" "}
                <span className="ml-2 text-xs text-muted-foreground">
                  {(r.rfq_vendors ?? []).filter((v) => v.status !== "pending").length}/
                  {(r.rfq_vendors ?? []).length} responses
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <WorkflowTimeline
        kind="purchase_request"
        status={pr.status}
        rfqStatuses={rfqs.isSuccess ? rfqs.data.map((r) => r.status) : undefined}
        events={history.map((event) => ({
          id: event.id,
          action: event.action,
          occurredAt: event.acted_at,
          actorName: name(event.acted_by),
          comment: event.comment,
          newStatus: event.new_status,
        }))}
      />

      <ProcurementRevisionHistory kind="purchase_request" documentId={id} />
      <Dialog open={!!act} onOpenChange={(o) => !o && setAct(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{act && ACTION_COPY[act]?.title}</DialogTitle>
            <DialogDescription>
              {act === "approved"
                ? "This marks the request as received for procurement and allows RFQ processing. It does not approve the final Purchase Order; that needs a separate Director decision."
                : act && ACTION_COPY[act]?.needs ? "A comment is required." : "Comment is optional."}{" "}
              Your action is recorded permanently in the audit history.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Comment"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAct(null)}>
              Close
            </Button>
            <Button
              variant={act ? ACTION_COPY[act]?.variant : undefined}
              disabled={run.isPending || (!!act && !!ACTION_COPY[act]?.needs && !comment.trim())}
              onClick={() => act && run.mutate(act)}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
