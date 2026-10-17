import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { CheckCircle2, ExternalLink, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadCompleteRows } from "@/lib/complete-register";
import { approvalPage, pendingApprovals } from "@/lib/approval-queue";
import { useMe } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { ApprovalDecisionDialog } from "@/components/erp/approval-decision-dialog";
import { Loading, PageHeader } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { ApprovalKindTabs } from "@/components/erp/approval-kind-tabs";
import { ApprovalStatusFilter } from "@/components/erp/approval-status-filter";
import { ApprovalDecisionHistory } from "@/components/erp/approval-decision-history";
import {
  APPROVAL_STATUS_FILTERS,
  approvalDetailsPath,
  approvalViewFor,
  isAwaitingApproval,
  type ApprovalView,
} from "@/lib/approval-history";
import { loadApprovalDecisions, type ApprovalHistoryDocument } from "@/lib/approval-history-query";
import { PO_STATUS, type PoStatus } from "@/lib/po";
import { PAYMENT_STATUS, type PaymentStatus } from "@/lib/finance";
import { errMsg, inr } from "@/lib/format";

type Kind = "purchase_order" | "vendor_payment";
type Request = ApprovalHistoryDocument & {
  id: string;
  kind: Kind;
  number: string;
  amount: number;
  status: string;
  projectId: string | null;
  project: string;
  vendor: string;
  createdBy: string;
};

export const Route = createFileRoute("/_authenticated/_shell/approvals")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { kind: Kind | null; id: string | null; view: ApprovalView | null } => {
    return {
      view:
        s["view"] === "pending" ||
        s["view"] === "approved" ||
        s["view"] === "rejected" ||
        s["view"] === "cancelled"
          ? s["view"]
          : null,
      kind: s["kind"] === "purchase_order" || s["kind"] === "vendor_payment" ? s["kind"] : null,
      id: typeof s["id"] === "string" && /^[0-9a-f-]{36}$/i.test(s["id"]) ? s["id"] : null,
    };
  },
  component: DirectorApprovals,
  head: () => ({ meta: [{ title: "Director Approvals — KK GROUP ERP" }] }),
});

function DirectorApprovals() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const activeKind = search.kind ?? "purchase_order";
  const view = approvalViewFor(activeKind, search.view ?? "pending");
  const me = useMe();
  const qc = useQueryClient();
  const [reason, setReason] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<{
    request: Request;
    decision: "approved" | "rejected";
    open: boolean;
  } | null>(null);
  const decisionTrigger = useRef<HTMLButtonElement | null>(null);
  const queueHeading = useRef<HTMLDivElement | null>(null);
  const scope = `${activeKind}:${view}:${search.id ?? ""}`;
  const [pagination, setPagination] = useState({ scope, page: 0 });
  const page = pagination.scope === scope ? pagination.page : 0;
  const setPage = (next: number) => setPagination({ scope, page: next });
  const selectQueue = (kind: Kind, nextView = view) => {
    setDecision(null);
    const selectedView = approvalViewFor(kind, nextView);
    setPagination({ scope: `${kind}:${selectedView}:`, page: 0 });
    void navigate({ search: { kind, id: null, view: selectedView } });
  };
  const isDirector = me.data?.roles.includes("director") ?? false;
  const isAdmin = me.data?.permissions.has("users.manage") ?? false;
  const q = useQuery({
    queryKey: [
      "director-approvals",
      me.data?.profile.id,
      isAdmin,
      me.data?.profile.company_id,
      view,
      search.id ? activeKind : null,
      search.id,
    ],
    enabled: isDirector || isAdmin,
    queryFn: async () => {
      const states = APPROVAL_STATUS_FILTERS[view];
      const [po, payments] = await Promise.all([
        (search.id && activeKind !== "purchase_order") ||
        (!search.id && !states.purchase_order.length)
          ? []
          : loadCompleteRows(async (start, end) => {
              const query = supabase
                .from("purchase_orders")
                .select(
                  "id,po_number,grand_total,status,project_id,created_by,approved_by,approved_at,approver:profiles!purchase_orders_approved_by_fkey(full_name),projects(name),vendors(company_name)",
                  { count: "exact" },
                );
              const filtered = search.id
                ? query.eq("id", search.id)
                : query.in("status", states.purchase_order);
              return await filtered
                .order("created_at", { ascending: false })
                .order("id", { ascending: false })
                .range(start, end);
            }),
        (search.id && activeKind !== "vendor_payment") ||
        (!search.id && !states.vendor_payment.length)
          ? []
          : loadCompleteRows(async (start, end) => {
              const query = supabase
                .from("vendor_payments")
                .select(
                  "id,payment_number,amount,status,project_id,created_by,approved_by,approved_at,approver:profiles!vendor_payments_approved_by_fkey(full_name),projects(name),vendors(company_name)",
                  { count: "exact" },
                );
              const filtered = search.id
                ? query.eq("id", search.id)
                : query.in("status", states.vendor_payment);
              return await filtered
                .order("created_at", { ascending: false })
                .order("id", { ascending: false })
                .range(start, end);
            }),
      ]);
      const requests: Request[] = [
        ...po.map((x) => ({
          id: x.id,
          kind: "purchase_order" as const,
          number: x.po_number,
          amount: Number(x.grand_total),
          status: x.status,
          projectId: x.project_id,
          project: x.projects?.name ?? "Project",
          vendor: x.vendors?.company_name ?? "Vendor",
          createdBy: x.created_by,
          approvedBy: x.approved_by,
          approvedAt: x.approved_at,
          approverName: x.approver?.full_name ?? null,
        })),
        ...payments.map((x) => ({
          id: x.id,
          kind: "vendor_payment" as const,
          number: x.payment_number,
          amount: Number(x.amount),
          status: x.status,
          projectId: x.project_id,
          project: x.projects?.name ?? "Company-wide",
          vendor: x.vendors?.company_name ?? "Vendor",
          createdBy: x.created_by,
          approvedBy: x.approved_by,
          approvedAt: x.approved_at,
          approverName: x.approver?.full_name ?? null,
        })),
      ];
      let directors: { id: string; full_name: string | null }[] = [];
      const companyId = me.data?.profile.company_id;
      if (isAdmin && companyId) {
        const [profiles, roles] = await Promise.all([
          loadCompleteRows(
            async (start, end) =>
              await supabase
                .from("profiles")
                .select("id,full_name,is_active", { count: "exact" })
                .eq("company_id", companyId)
                .eq("is_active", true)
                .order("id")
                .range(start, end),
          ),
          loadCompleteRows(
            async (start, end) =>
              await supabase
                .from("user_roles")
                .select("id,user_id", { count: "exact" })
                .eq("role", "director")
                .order("id")
                .range(start, end),
          ),
        ]);
        const directorIds = new Set(roles.map((r) => r.user_id));
        directors = profiles.filter((x) => directorIds.has(x.id));
      }
      return { requests, directors };
    },
  });
  const action = useMutation({
    mutationFn: async ({
      request,
      decision,
    }: {
      request: Request;
      decision: "approved" | "rejected";
    }) => {
      const comment = (reason[request.id] ?? "").trim();
      if (decision === "rejected" && !comment) throw new Error("Enter a reason for rejection.");
      if (request.kind === "vendor_payment" && decision === "rejected")
        throw new Error(
          "Payment rejection requires an explicit cancellation workflow. Contact the administrator.",
        );
      const result =
        request.kind === "purchase_order"
          ? await supabase.rpc("po_transition", {
              _po_id: request.id,
              _action: decision,
              _comment: comment,
            })
          : await supabase.rpc("payment_transition", {
              _id: request.id,
              _action: "approve",
              _comment: comment,
              _details: {},
            });
      if (result.error) throw result.error;
    },
    onSuccess: (_, { request }) => {
      toast.success("Decision recorded");
      setDecision((prev) => (prev ? { ...prev, open: false } : null));
      setReason((prev) => {
        const next = { ...prev };
        delete next[request.id];
        return next;
      });
      for (const key of [
        "director-approvals",
        "approval-decisions",
        "director-pending-count",
        "po",
        "pos",
        "payment-detail",
        "vendor-payments",
      ])
        void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const requests = q.data?.requests ?? [];
  const pending = pendingApprovals(requests, activeKind, search.id);
  const counts = q.data
    ? {
        purchase_order: pendingApprovals(requests, "purchase_order").length,
        vendor_payment: pendingApprovals(requests, "vendor_payment").length,
      }
    : undefined;
  const directors = q.data?.directors ?? [];
  const visible = approvalPage(pending, page);
  const history = useQuery({
    queryKey: [
      "approval-decisions",
      me.data?.profile.id,
      visible.items.map((item) => [item.kind, item.id, item.status, item.approvedAt]),
    ],
    enabled: q.isSuccess && visible.items.length > 0,
    queryFn: () => loadApprovalDecisions(visible.items),
  });
  if (me.isLoading) return <Loading />;
  if (me.error)
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
      >
        Your permissions could not be verified: {errMsg(me.error)}
      </div>
    );
  if (!isDirector && !isAdmin)
    return (
      <div className="mx-auto max-w-lg rounded-xl border bg-card p-6">
        <ShieldCheck className="mb-3 h-7 w-7" />
        <h1 className="text-lg font-semibold">Restricted access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only directors can vote. Administrators can review the queue without gaining voting
          rights.
        </p>
      </div>
    );
  return (
    <div className="director-approvals mx-auto max-w-3xl">
      <div ref={queueHeading} tabIndex={-1} className="outline-none">
        <PageHeader
          title="Approvals"
          subtitle={
            isAdmin && !isDirector
              ? "Monitor orders, payments and director decisions."
              : "Review orders and payments. Keep work moving."
          }
        />
      </div>
      <ApprovalKindTabs value={activeKind} counts={counts} onChange={(kind) => selectQueue(kind)} />
      <div className="mb-4 flex items-center justify-between gap-3">
        <ApprovalStatusFilter
          kind={activeKind}
          value={view}
          onChange={(next) => selectQueue(activeKind, next)}
        />
        {search.id && (
          <Button size="sm" variant="ghost" onClick={() => selectQueue(activeKind)}>
            Show all
          </Button>
        )}
      </div>
      {search.id && (
        <p className="mb-4 text-xs text-muted-foreground">
          Showing the linked request. Choose a status to browse the queue.
        </p>
      )}
      <p className="approval-trust-note">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        Your name and decision time are recorded.
      </p>
      {isAdmin && directors.length === 0 && (
        <div role="status" className="mb-5 rounded-xl border bg-card p-4 text-sm">
          At least one active director account is required. Found 0. Review accounts in{" "}
          <a href="/settings/users" className="font-semibold underline">
            Users & Roles
          </a>
          .
        </div>
      )}
      <div
        id="approval-queue-panel"
        role="tabpanel"
        aria-labelledby={`approval-tab-${activeKind}`}
        tabIndex={0}
      >
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
          >
            Director approvals could not be verified: {errMsg(q.error)}{" "}
            <Button variant="outline" size="sm" onClick={() => q.refetch()}>
              Retry
            </Button>
          </div>
        ) : !pending.length ? (
          <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            {search.id
              ? "This request is unavailable or you do not have access to it."
              : `No ${view} ${activeKind === "purchase_order" ? "purchase orders" : "vendor payments"}.`}
          </div>
        ) : (
          <div className="space-y-4">
            {visible.items.map((r) => {
              const decisions = (history.data ?? []).filter(
                (row) => row.kind === r.kind && row.documentId === r.id,
              );
              const votes = decisions.filter((row) => row.source === "vote");
              const mine = votes.find((row) => row.actorId === me.data?.profile.id);
              const waiting = isAwaitingApproval(r.kind, r.status);
              const canVote =
                isDirector &&
                waiting &&
                history.isSuccess &&
                !history.isFetching &&
                !mine &&
                r.createdBy !== me.data?.profile.id;
              const status =
                r.kind === "purchase_order"
                  ? PO_STATUS[r.status as PoStatus]
                  : PAYMENT_STATUS[r.status as PaymentStatus];
              return (
                <section
                  key={r.kind + r.id}
                  className="approval-request-card rounded-2xl border bg-card p-4 shadow-card sm:p-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {r.kind === "purchase_order" ? "Purchase order" : "Vendor payment"}
                      </p>
                      <h2 className="mt-1 break-words text-lg font-bold">{r.number}</h2>
                    </div>
                    <span
                      className={`max-w-[50%] shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${status.cls}`}
                    >
                      {status.label}
                    </span>
                  </div>
                  <p className="num mt-3 text-3xl font-semibold tracking-tight text-foreground">
                    {inr(r.amount)}
                  </p>
                  <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Project
                      </dt>
                      <dd className="break-words font-medium">{r.project}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Vendor
                      </dt>
                      <dd className="break-words font-medium">{r.vendor}</dd>
                    </div>
                  </dl>

                  <a
                    href={approvalDetailsPath(r.kind, r.id)}
                    className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Full details <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  {isAdmin && waiting && history.isSuccess && directors.length > 0 && (
                    <div className="mt-4 rounded-xl border p-3">
                      <h3 className="mb-2 text-sm font-semibold">Director decisions</h3>
                      {directors.map((d) => {
                        const vote = votes.find((v) => v.actorId === d.id);
                        return (
                          <p key={d.id} className="border-t py-2 text-sm">
                            {d.full_name || "Director"} · {vote?.decision ?? "Pending"}
                          </p>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-3">
                    {history.isLoading ? (
                      <p className="text-xs text-muted-foreground">Loading decision history…</p>
                    ) : history.error ? (
                      <div role="alert" className="text-xs text-destructive">
                        Decision history could not be verified.{" "}
                        <Button size="sm" variant="ghost" onClick={() => history.refetch()}>
                          Retry
                        </Button>
                      </div>
                    ) : decisions.length > 0 || !waiting ? (
                      <ApprovalDecisionHistory rows={decisions} />
                    ) : null}
                  </div>
                  {waiting &&
                    isDirector &&
                    (mine ? (
                      <p className="mt-4 rounded-lg bg-muted p-3 text-sm">
                        Your decision: {mine.decision} ·{" "}
                        {new Date(mine.occurredAt).toLocaleString()}
                      </p>
                    ) : r.createdBy === me.data?.profile.id ? (
                      <p className="mt-4 text-sm text-muted-foreground">
                        You cannot approve a request you created.
                      </p>
                    ) : !canVote ? null : (
                      <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-4">
                        {r.kind === "purchase_order" && (
                          <Button
                            className="approval-action min-h-12"
                            variant="outline"
                            disabled={action.isPending}
                            onClick={(event) => {
                              decisionTrigger.current = event.currentTarget;
                              action.reset();
                              setDecision({ request: r, decision: "rejected", open: true });
                            }}
                          >
                            <XCircle className="h-4 w-4" aria-hidden="true" />
                            Reject
                          </Button>
                        )}
                        <Button
                          className={`approval-action min-h-12 ${r.kind === "vendor_payment" ? "col-span-2" : ""}`}
                          disabled={action.isPending}
                          onClick={(event) => {
                            decisionTrigger.current = event.currentTarget;
                            action.reset();
                            setDecision({ request: r, decision: "approved", open: true });
                          }}
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          Approve
                        </Button>
                      </div>
                    ))}
                </section>
              );
            })}
            <Pager page={visible.page} total={visible.total} size={15} onPage={setPage} />
          </div>
        )}
      </div>
      <ApprovalDecisionDialog
        target={decision?.request ?? null}
        open={decision?.open ?? false}
        decision={decision?.decision ?? "approved"}
        comment={decision ? (reason[decision.request.id] ?? "") : ""}
        onComment={(value) => {
          if (decision) setReason((prev) => ({ ...prev, [decision.request.id]: value }));
        }}
        onConfirm={() => {
          if (decision?.open && !action.isPending) action.mutate(decision);
        }}
        onClose={() => {
          if (!action.isPending) setDecision((prev) => (prev ? { ...prev, open: false } : null));
        }}
        onReturnFocus={() => {
          const trigger = decisionTrigger.current;
          if (trigger?.isConnected) trigger.focus();
          else queueHeading.current?.focus();
        }}
        busy={action.isPending}
        error={action.error ? errMsg(action.error) : undefined}
      />
    </div>
  );
}
