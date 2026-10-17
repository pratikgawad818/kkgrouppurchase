import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { documentActorNames } from "@/lib/document-actors";
import { supabase } from "@/integrations/supabase/client";
import { loadCompleteRows } from "@/lib/complete-register";
import { loadApprovalDecisions } from "@/lib/approval-history-query";
import { ApprovalDecisionHistory } from "@/components/erp/approval-decision-history";
import { Button } from "@/components/ui/button";
import { Field, Loading, PageHeader } from "@/components/erp/common";
import { PAYMENT_MODES, PAYMENT_STATUS, openVendorDoc } from "@/lib/finance";
import { checkedAdvanceUsage, remainingAdvanceAmount } from "@/lib/payment-preflight";
import { useCan, useMe } from "@/lib/session";
import { errMsg, fmtDate, fmtDateTime, inr } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/_shell/finance/payments/$id")({
  component: PaymentDetail,
  head: () => ({ meta: [{ title: "Payment Details — KK GROUP ERP" }] }),
});

function PaymentDetail() {
  const { id } = Route.useParams();
  const can = useCan();
  const me = useMe();
  const q = useQuery({
    queryKey: ["payment-detail", id],
    queryFn: async () => {
      const { data: payment, error } = await supabase
        .from("vendor_payments")
        .select(
          "*,vendors(company_name),projects(name),company_bank_accounts(account_name,bank_name),creator:profiles!vendor_payments_created_by_fkey(full_name),approver:profiles!vendor_payments_approved_by_fkey(full_name),recorder:profiles!vendor_payments_recorded_by_fkey(full_name)",
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      const [allocations, adjustments, decisions, events, names] = await Promise.all([
        loadCompleteRows(
          async (start, end) =>
            await supabase
              .from("vendor_payment_allocations")
              .select(
                "id,invoice_id,amount,vendor_invoices(invoice_number,vendor_invoice_number)",
                { count: "exact" },
              )
              .eq("payment_id", id)
              .order("id")
              .range(start, end),
        ),
        payment.kind === "advance"
          ? loadCompleteRows(
              async (start, end) =>
                await supabase
                  .from("vendor_advance_adjustments")
                  .select(
                    "id,advance_payment_id,invoice_id,amount,created_at,vendor_invoices(invoice_number)",
                    { count: "exact" },
                  )
                  .eq("advance_payment_id", id)
                  .order("created_at")
                  .order("id")
                  .range(start, end),
            )
          : [],
        loadApprovalDecisions([
          {
            id,
            kind: "vendor_payment",
            approvedBy: payment.approved_by,
            approvedAt: payment.approved_at,
            approverName: payment.approver?.full_name ?? null,
          },
        ]),
        loadCompleteRows(
          async (start, end) =>
            await supabase
              .from("vendor_payment_events")
              .select("id,action,acted_by,acted_at,comment,actor:profiles(full_name)", {
                count: "exact",
              })
              .eq("payment_id", id)
              .order("acted_at")
              .order("id")
              .range(start, end),
        ),
        documentActorNames("vendor_payment", [id]),
      ]);
      payment.creator = {
        full_name:
          names.get(payment.created_by) ?? payment.creator?.full_name ?? "Staff name unavailable",
      };
      payment.approver = {
        full_name:
          (payment.approved_by ? names.get(payment.approved_by) : null) ??
          payment.approver?.full_name ??
          "Staff name unavailable",
      };
      payment.recorder = {
        full_name:
          (payment.recorded_by ? names.get(payment.recorded_by) : null) ??
          payment.recorder?.full_name ??
          "Staff name unavailable",
      };
      const namedEvents = events.map((row) => ({
        ...row,
        actor: {
          full_name:
            (row.acted_by ? names.get(row.acted_by) : null) ??
            row.actor?.full_name ??
            "Staff name unavailable",
        },
      }));
      const used = checkedAdvanceUsage(adjustments);
      const remaining = remainingAdvanceAmount(Number(payment.amount), used.get(id) ?? 0);
      if (payment.kind === "advance" && remaining === null)
        throw new Error("Advance adjustment history is inconsistent. Contact Accounts.");
      return { payment, allocations, adjustments, decisions, events: namedEvents, remaining };
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error)
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive"
      >
        Payment details could not be verified, or you do not have access: {errMsg(q.error)}{" "}
        <Button size="sm" variant="outline" onClick={() => q.refetch()}>
          Retry
        </Button>
      </div>
    );
  const { payment: p, allocations, adjustments, decisions, events, remaining } = q.data!;
  const status = PAYMENT_STATUS[p.status];
  const eventLabels: Record<string, string> = {
    schedule: "Scheduled",
    scheduled: "Scheduled",
    approve: "Approved",
    record: "Payment recorded",
    cancel: "Cancelled",
  };
  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-16">
      <PageHeader
        actions={
          p.status === "scheduled" && me.data?.roles.includes("director") ? (
            <Button className="approval-action" asChild>
              <Link to="/approvals" search={{ kind: "vendor_payment", view: "pending", id }}>
                Review approval
              </Link>
            </Button>
          ) : undefined
        }
        title={p.payment_number}
        crumbs={
          <Link to="/finance/payments" className="text-primary hover:underline">
            Vendor Payments
          </Link>
        }
        subtitle={
          <span className={`rounded-full border px-3 py-1 text-xs ${status.cls}`}>
            {status.label}
          </span>
        }
      />
      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <p className="mb-5 text-3xl font-semibold tabular-nums">{inr(p.amount)}</p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Field className="col-span-2 sm:col-span-1" label="Vendor">
            {p.vendors?.company_name}
          </Field>
          <Field className="col-span-2 sm:col-span-1" label="Project">
            {p.projects?.name ?? "Company-wide"}
          </Field>
          <Field label="Type">{p.kind === "advance" ? "Vendor advance" : "Invoice payment"}</Field>
          <Field label="Payment date">{fmtDate(p.payment_date)}</Field>
          <Field label="Payment mode">
            {PAYMENT_MODES.find((mode) => mode[0] === p.payment_mode)?.[1] ?? p.payment_mode}
          </Field>
          <Field label="Bank account">{p.company_bank_accounts?.account_name}</Field>
          <Field label="Bank">{p.company_bank_accounts?.bank_name}</Field>
          <Field label="UTR / cheque / reference">{p.reference}</Field>
          <Field label="Created by">{p.creator?.full_name ?? "Staff name unavailable"}</Field>
          <Field label="Created at">{fmtDateTime(p.created_at)}</Field>
          <Field label="Approved by">
            {p.approved_by || p.approved_at
              ? (p.approver?.full_name ?? "Staff name unavailable")
              : p.status === "scheduled"
                ? "Awaiting approval"
                : "—"}
          </Field>
          <Field label="Approved at">{p.approved_at ? fmtDateTime(p.approved_at) : "—"}</Field>
          {p.recorded_at && (
            <>
              <Field label="Recorded by">{p.recorder?.full_name ?? "Staff name unavailable"}</Field>
              <Field label="Recorded at">{fmtDateTime(p.recorded_at)}</Field>
            </>
          )}
          {p.kind === "advance" && p.status === "recorded" && (
            <Field label="Unadjusted advance">{inr(remaining ?? 0)}</Field>
          )}
        </div>
        {p.remarks && (
          <div className="mt-4 text-sm">
            <p className="text-xs font-semibold text-muted-foreground">Remarks / purpose</p>
            <p className="whitespace-pre-wrap break-words">{p.remarks}</p>
          </div>
        )}
        {p.proof_path && (
          <Button
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() =>
              openVendorDoc(p.proof_path!).catch((error) => toast.error(errMsg(error)))
            }
          >
            View payment proof
          </Button>
        )}
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 font-semibold">Approval decisions</h2>
        <ApprovalDecisionHistory rows={decisions} />
      </section>
      {(allocations.length > 0 || adjustments.length > 0) && (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 font-semibold">
            {p.kind === "advance" ? "Advance adjustments" : "Invoice allocations"}
          </h2>
          <ul className="divide-y">
            {[...allocations, ...adjustments].map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                {can("vendor_invoice.view") ? (
                  <Link
                    className="text-primary hover:underline"
                    to="/finance/vendor-invoices/$id"
                    params={{ id: row.invoice_id }}
                  >
                    {row.vendor_invoices?.invoice_number ?? "View invoice"}
                  </Link>
                ) : (
                  <span>{row.vendor_invoices?.invoice_number ?? "Invoice"}</span>
                )}
                <span className="tabular-nums">{inr(row.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 font-semibold">Payment history</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lifecycle events recorded.</p>
        ) : (
          <ol className="space-y-4 border-l pl-4">
            {events.map((event) => (
              <li key={event.id} className="text-sm">
                <p className="font-medium">
                  {eventLabels[event.action] ?? event.action} ·{" "}
                  {event.actor?.full_name ?? "Staff name unavailable"}
                </p>
                <time className="text-xs text-muted-foreground" dateTime={event.acted_at}>
                  {fmtDateTime(event.acted_at)}
                </time>
                {event.comment && (
                  <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                    {event.comment}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
