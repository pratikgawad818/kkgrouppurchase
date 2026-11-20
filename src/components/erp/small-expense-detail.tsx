import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { CalendarDays, Eye, FileImage, FileText, History, ReceiptText, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtDate, fmtDateTime, inr, errMsg } from "@/lib/format";
import { SMALL_EXPENSE_CATEGORIES, SMALL_EXPENSE_PAYMENTS } from "@/lib/small-expenses";
import { viewSmallExpenseBill, type ExpenseBill } from "@/lib/small-expense-bills";

// The bills table was introduced in migration 0077. The connected Supabase
// generated client is still compiled against the older schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const billsDb = supabase as any;

export type SmallExpenseRecord = {
  id: string;
  spent_on: string;
  project_id: string | null;
  building_id: string | null;
  category: string;
  other_category_detail: string | null;
  amount: number;
  payment_method: string;
  paid_to: string;
  description: string;
  receipt_reference: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  projects: { name: string } | null;
  buildings: { name: string } | null;
};

type ExpenseEvent = {
  id: string;
  action: string;
  reason: string | null;
  actor_id: string;
  created_at: string;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
};

const categories = SMALL_EXPENSE_CATEGORIES as Record<string, string>;
const paymentMethods = SMALL_EXPENSE_PAYMENTS as Record<string, string>;

const REVIEW_FIELDS = [
  ["spent_on", "Expense date"],
  ["project_id", "Project"],
  ["building_id", "Building"],
  ["category", "Category"],
  ["other_category_detail", "Category details"],
  ["amount", "Amount"],
  ["payment_method", "Payment method"],
  ["paid_to", "Paid to"],
  ["description", "Description"],
  ["receipt_reference", "Receipt reference"],
] as const;

export async function getSmallExpenseBills(expenseId: string): Promise<ExpenseBill[]> {
  const { data, error } = await billsDb.from("site_small_expense_bills")
    .select("id,expense_id,storage_path,file_name,mime_type,byte_size,created_at,is_active")
    .eq("expense_id", expenseId).eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ExpenseBill[];
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-3.5 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 min-w-0 break-words text-sm font-semibold leading-relaxed text-foreground">
        {children || "—"}
      </dd>
    </div>
  );
}

function showChange(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (key === "amount") return inr(Number(value));
  if (key === "spent_on") return fmtDate(String(value));
  if (key === "category") return categories[String(value)] ?? String(value);
  if (key === "payment_method") return paymentMethods[String(value)] ?? String(value);
  // Reference IDs are useful in the ledger, not in a small mobile detail view.
  if (key === "project_id" || key === "building_id") return value ? "Assigned" : "General";
  return String(value);
}

function EditSummary({ event }: { event: ExpenseEvent }) {
  const before = event.before_values ?? {};
  const after = event.after_values ?? {};
  const changes = REVIEW_FIELDS.filter(([key]) =>
    JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  return (
    <details className="mt-2 rounded-lg border bg-background">
      <summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold text-foreground">
        View changes ({changes.length})
      </summary>
      <div className="space-y-2 border-t px-3 py-3">
        {changes.length === 0 && (
          <p className="text-xs text-muted-foreground">No changes to the displayed expense fields.</p>
        )}
        {changes.map(([key, label]) => (
          <div key={key} className="min-w-0 rounded-md bg-muted/40 p-2.5 text-xs">
            <p className="mb-1 font-semibold">{label}</p>
            {key === "project_id" || key === "building_id" ? (
              <p className="text-muted-foreground">Assignment updated</p>
            ) : (
              <div className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-2">
                <p className="min-w-0 break-words text-muted-foreground">
                  Before: <span className="text-foreground">{showChange(key, before[key])}</span>
                </p>
                <p className="min-w-0 break-words text-muted-foreground">
                  After: <span className="text-foreground">{showChange(key, after[key])}</span>
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

/** Read-only on every role; especially Director. Never includes edit/void/delete controls. */
export function SmallExpenseDetail({
  expense, onClose,
}: {
  expense: SmallExpenseRecord | null;
  onClose: () => void;
}) {
  const [opening, setOpening] = useState<string | null>(null);
  const bills = useQuery({
    queryKey: ["small-expense-detail", expense?.id, "bills"],
    enabled: !!expense,
    queryFn: () => getSmallExpenseBills(expense!.id),
  });
  const events = useQuery({
    queryKey: ["small-expense-detail", expense?.id, "events"],
    enabled: !!expense,
    queryFn: async () => {
      const { data, error } = await billsDb.from("site_small_expense_events")
        .select("id,action,reason,actor_id,created_at,before_values,after_values")
        .eq("expense_id", expense!.id)
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as ExpenseEvent[];
    },
  });

  return (
    <Dialog open={!!expense} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        className="!left-0 !top-0 !flex !h-[100dvh] !max-h-[100dvh] !w-screen !max-w-none !translate-x-0 !translate-y-0 !flex-col !gap-0 !overflow-hidden !rounded-none !border-0 !p-0 sm:!left-1/2 sm:!top-1/2 sm:!h-auto sm:!max-h-[90dvh] sm:!w-[calc(100vw-2rem)] sm:!max-w-2xl sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:!rounded-2xl sm:!border"
        aria-label="Read-only small expense details"
      >
        <DialogHeader className="shrink-0 border-b px-4 pb-3 pr-12 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pb-4 sm:pr-12 sm:pt-6">
          <DialogTitle className="flex items-center gap-2 text-base leading-snug sm:text-lg">
            <ReceiptText className="h-5 w-5 shrink-0 text-primary" />
            Small expense details
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed sm:text-sm">
            View-only record · No changes or corrections will be made.
          </DialogDescription>
        </DialogHeader>

        {expense && (
          <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6 sm:py-5">
            <section className="min-w-0 rounded-2xl border bg-muted/25 p-4 sm:p-5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Wallet className="h-4 w-4" aria-hidden="true" /> Amount paid
              </p>
              <p className="mt-1.5 break-all text-[clamp(1.65rem,7vw,2.25rem)] font-bold leading-tight tracking-tight tabular-nums">
                {inr(expense.amount)}
              </p>
              <p className="mt-3 min-w-0 break-words text-sm font-medium">{expense.paid_to}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {fmtDate(expense.spent_on)}
              </p>
            </section>

            <section className="min-w-0 space-y-2.5" aria-label="Expense information">
              <h3 className="text-sm font-semibold">Payment & location</h3>
              <dl className="grid min-w-0 grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
                <DetailField label="Project">{expense.projects?.name ?? "General office"}</DetailField>
                <DetailField label="Building / wing">{expense.buildings?.name ?? "General"}</DetailField>
                <DetailField label="Category">{categories[expense.category] ?? expense.category}</DetailField>
                <DetailField label="Payment method">{paymentMethods[expense.payment_method] ?? expense.payment_method}</DetailField>
                {expense.other_category_detail && (
                  <DetailField label="Category details">{expense.other_category_detail}</DetailField>
                )}
                <DetailField label="Bill / receipt number">{expense.receipt_reference ?? "Not provided"}</DetailField>
              </dl>
            </section>

            <section className="min-w-0 space-y-2.5">
              <h3 className="text-sm font-semibold">Description</h3>
              <p className="min-w-0 whitespace-pre-wrap break-words rounded-xl border bg-card p-3.5 text-sm leading-relaxed">
                {expense.description || "No description available."}
              </p>
            </section>

            <section className="min-w-0 space-y-2.5" aria-label="Attached bills and receipts">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Bills & receipts</h3>
                {bills.data && (
                  <span className="text-xs text-muted-foreground">{bills.data.length} attached</span>
                )}
              </div>
              {bills.isLoading && (
                <p role="status" className="rounded-xl border bg-card p-3 text-xs text-muted-foreground">
                  Loading attached bills…
                </p>
              )}
              {bills.error && (
                <p role="alert" className="rounded-xl border border-destructive/40 p-3 text-xs text-destructive">
                  Unable to load bills: {errMsg(bills.error)}
                </p>
              )}
              {bills.data?.length === 0 && (
                <p className="rounded-xl border bg-card p-3.5 text-xs text-muted-foreground">
                  No bill images or PDFs are attached.
                </p>
              )}
              <div className="space-y-2">
                {bills.data?.map((bill) => (
                  <div key={bill.id} className="flex min-w-0 items-center gap-3 rounded-xl border bg-card p-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted">
                      {bill.mime_type === "application/pdf"
                        ? <FileText className="h-5 w-5" aria-hidden="true" />
                        : <FileImage className="h-5 w-5" aria-hidden="true" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={bill.file_name}>{bill.file_name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {bill.mime_type === "application/pdf" ? "PDF bill" : "Bill image"}
                        {" · "}{Math.ceil(bill.byte_size / 1024)} KB
                      </p>
                    </div>
                    <Button
                      type="button" size="sm" variant="outline"
                      className="min-h-10 shrink-0 gap-1.5"
                      aria-label={`View bill ${bill.file_name}`}
                      disabled={opening !== null}
                      onClick={async () => {
                        setOpening(bill.id);
                        try { await viewSmallExpenseBill(bill); }
                        catch (error) { toast.error(errMsg(error)); }
                        finally { setOpening(null); }
                      }}
                    >
                      <Eye className="h-4 w-4" aria-hidden="true" />
                      {opening === bill.id ? "Opening…" : "View"}
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            <section className="min-w-0 space-y-2.5" aria-label="Expense activity history">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-sm font-semibold">Activity history</h3>
              </div>
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                <DetailField label="Recorded">{fmtDateTime(expense.created_at)}</DetailField>
                <DetailField label="Last updated">{fmtDateTime(expense.updated_at)}</DetailField>
              </div>
              {events.isLoading && (
                <p role="status" className="rounded-xl border p-3 text-xs text-muted-foreground">
                  Loading history…
                </p>
              )}
              {events.error && (
                <p role="alert" className="rounded-xl border border-destructive/40 p-3 text-xs text-destructive">
                  Unable to load activity history: {errMsg(events.error)}
                </p>
              )}
              {!!events.data?.length && (
                <details className="min-w-0 rounded-xl border bg-card p-3.5">
                  <summary className="cursor-pointer text-sm font-medium">
                    Show history ({events.data.length})
                  </summary>
                  <ol className="mt-4 space-y-3 border-l pl-3.5">
                    {events.data.map((event) => (
                      <li key={event.id} className="min-w-0 space-y-1.5 text-xs">
                        <p className="font-semibold capitalize">{event.action.replace(/_/g, " ")}</p>
                        <time className="block break-words text-muted-foreground" dateTime={event.created_at}>
                          {fmtDateTime(event.created_at)}
                        </time>
                        {event.reason && (
                          <p className="whitespace-pre-wrap break-words leading-relaxed">{event.reason}</p>
                        )}
                        {event.action === "edited" && <EditSummary event={event} />}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </section>
          </div>
        )}

        <div className="shrink-0 border-t bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-4">
          <Button type="button" className="h-11 w-full sm:ml-auto sm:w-32" variant="outline" onClick={onClose}>
            Close details
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
