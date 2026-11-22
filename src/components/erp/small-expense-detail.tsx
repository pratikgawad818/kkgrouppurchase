import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CalendarDays, Eye, FileImage, FileText, History, Receipt, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtDateTime, inr, errMsg } from "@/lib/format";
import { SMALL_EXPENSE_CATEGORIES, SMALL_EXPENSE_PAYMENTS } from "@/lib/small-expenses";
import { viewSmallExpenseBill, type ExpenseBill } from "@/lib/small-expense-bills";
import { useMe } from "@/lib/session";

// The bill attachment table was added after the original Supabase type snapshot.
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

const categoryLabels = SMALL_EXPENSE_CATEGORIES as Record<string, string>;
const paymentLabels = SMALL_EXPENSE_PAYMENTS as Record<string, string>;
const revisionLabels: ReadonlyArray<readonly [string, string]> = [
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
];

export async function getSmallExpenseBills(expenseId: string): Promise<ExpenseBill[]> {
  const { data, error } = await billsDb.from("site_small_expense_bills")
    .select("id,expense_id,storage_path,file_name,mime_type,byte_size,created_at,is_active")
    .eq("expense_id", expenseId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ExpenseBill[];
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[100px_minmax(0,1fr)] items-start gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[150px_minmax(0,1fr)]">
      <dt className="text-xs font-medium leading-5 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-medium leading-5 text-foreground [overflow-wrap:anywhere]">
        {children || "—"}
      </dd>
    </div>
  );
}

function changeValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (key === "amount") return inr(Number(value));
  if (key === "spent_on") return fmtDate(String(value));
  if (key === "category") return categoryLabels[String(value)] ?? String(value);
  if (key === "payment_method") return paymentLabels[String(value)] ?? String(value);
  // Raw UUIDs do not make a useful phone-sized audit log.
  if (key === "project_id" || key === "building_id") return value ? "Assigned" : "General";
  return String(value);
}

function EditSummary({ event }: { event: ExpenseEvent }) {
  const before = event.before_values ?? {};
  const after = event.after_values ?? {};
  const changed = revisionLabels.filter(([key]) =>
    JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  return (
    <details className="mt-2 min-w-0 rounded-lg border bg-background">
      <summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold">
        View {changed.length} changed field{changed.length === 1 ? "" : "s"}
      </summary>
      <div className="space-y-2 border-t p-3">
        {changed.length === 0 && <p className="text-xs text-muted-foreground">No visible expense fields changed.</p>}
        {changed.map(([key, label]) => (
          <div className="min-w-0 rounded-lg bg-muted/40 p-2.5 text-xs" key={key}>
            <p className="mb-2 font-semibold">{label}</p>
            {key === "project_id" || key === "building_id" ? (
              <p className="text-muted-foreground">Assignment updated</p>
            ) : (
              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">Before</p>
                  <p className="mt-0.5 break-words [overflow-wrap:anywhere]">{changeValue(key, before[key])}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">After</p>
                  <p className="mt-0.5 break-words [overflow-wrap:anywhere]">{changeValue(key, after[key])}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * Read-only expense inspection on every role, including Director.
 *
 * This is intentionally NOT a Radix Dialog: the global dialog primitive is
 * centered with translate(-50%, -50%), which is fragile when overridden into
 * a full-screen sheet at narrow mobile viewport widths. A dedicated portal
 * gives us one stable scroll container and keeps the mobile bottom nav below
 * the viewer. The separate document viewer remains above this layer (z-100).
 */
export function SmallExpenseDetail({
  expense, onClose,
}: {
  expense: SmallExpenseRecord | null;
  onClose: () => void;
}) {
  const me = useMe();
  const viewerId = me.data?.profile.id;
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    if (!expense) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key === "Tab") {
        const panel = document.getElementById("expense-view-panel");
        if (!panel) return;
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], summary, [tabindex]:not([tabindex='-1'])",
        )).filter(element => element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [expense?.id]);

  const bills = useQuery({
    queryKey: ["small-expense-detail", expense?.id, "bills", viewerId],
    enabled: !!expense && !!viewerId,
    queryFn: () => getSmallExpenseBills(expense!.id),
  });
  const events = useQuery({
    queryKey: ["small-expense-detail", expense?.id, "events", viewerId],
    enabled: !!expense && !!viewerId,
    queryFn: async () => {
      const { data, error } = await billsDb.from("site_small_expense_events")
        .select("id,action,reason,actor_id,created_at,before_values,after_values")
        .eq("expense_id", expense!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ExpenseEvent[];
    },
  });

  if (!expense || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex min-w-0 items-stretch justify-center bg-background sm:items-center sm:bg-black/60"
      onMouseDown={event => {
        // Backdrop closes on desktop; taps on the content never dismiss it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        id="expense-view-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-view-heading"
        aria-describedby="expense-view-description"
        className="relative z-[61] flex h-[100dvh] min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background text-foreground shadow-xl sm:h-[90dvh] sm:max-h-[860px] sm:w-[min(680px,calc(100vw-32px))] sm:rounded-2xl sm:border"
      >
        <header className="shrink-0 border-b bg-background px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-card text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Back to Small Expenses"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1">
              <h2 id="expense-view-heading" className="text-base font-bold leading-snug sm:text-lg">
                Expense details
              </h2>
              <p id="expense-view-description" className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                View only · No changes will be made
              </p>
            </div>
          </div>
        </header>

        <main className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6 sm:py-5">
          <section className="min-w-0 rounded-2xl border bg-muted/25 px-4 py-5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Wallet className="h-4 w-4" aria-hidden="true" /> Amount paid
            </div>
            <p className="mt-1.5 break-words text-[clamp(1.7rem,8vw,2.4rem)] font-bold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere]">
              {inr(expense.amount)}
            </p>
            <p className="mt-3 break-words text-sm font-semibold">{expense.paid_to}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {fmtDate(expense.spent_on)}
            </p>
          </section>

          <section className="min-w-0 space-y-2.5" aria-label="Payment information">
            <h3 className="text-sm font-semibold">Payment information</h3>
            <dl className="min-w-0 divide-y rounded-xl border bg-card">
              <InfoRow label="Project">{expense.projects?.name ?? "General office"}</InfoRow>
              <InfoRow label="Building">{expense.buildings?.name ?? "General"}</InfoRow>
              <InfoRow label="Category">{categoryLabels[expense.category] ?? expense.category}</InfoRow>
              {expense.other_category_detail && (
                <InfoRow label="Category detail">{expense.other_category_detail}</InfoRow>
              )}
              <InfoRow label="Paid through">
                {paymentLabels[expense.payment_method] ?? expense.payment_method}
              </InfoRow>
              <InfoRow label="Receipt no.">{expense.receipt_reference ?? "Not provided"}</InfoRow>
            </dl>
          </section>

          <section className="min-w-0 space-y-2.5" aria-label="Purpose of expense">
            <h3 className="text-sm font-semibold">Purpose / description</h3>
            <p className="min-w-0 whitespace-pre-wrap break-words rounded-xl border bg-card px-4 py-3 text-sm leading-relaxed [overflow-wrap:anywhere]">
              {expense.description || "No description recorded."}
            </p>
          </section>

          <section className="min-w-0 space-y-2.5" aria-label="Attached bills">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Receipt className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Bills & receipts
              </h3>
              {bills.data && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {bills.data.length} attached
                </span>
              )}
            </div>
            {bills.isLoading && (
              <p role="status" className="rounded-xl border p-3 text-xs text-muted-foreground">
                Loading bills…
              </p>
            )}
            {bills.error && (
              <p role="alert" className="rounded-xl border border-destructive/30 p-3 text-xs text-destructive">
                Could not load bills: {errMsg(bills.error)}
              </p>
            )}
            {bills.data?.length === 0 && (
              <p className="rounded-xl border bg-card p-3 text-xs text-muted-foreground">
                No bill images or PDFs attached.
              </p>
            )}
            <div className="space-y-2">
              {bills.data?.map(bill => (
                <div key={bill.id} className="flex min-w-0 items-center gap-2.5 rounded-xl border bg-card p-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted">
                    {bill.mime_type === "application/pdf"
                      ? <FileText className="h-5 w-5" aria-hidden="true" />
                      : <FileImage className="h-5 w-5" aria-hidden="true" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={bill.file_name}>{bill.file_name}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {bill.mime_type === "application/pdf" ? "PDF" : "Image"}
                      {" · "}{Math.ceil(bill.byte_size / 1024)} KB
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 shrink-0 gap-1.5"
                    aria-label={`View bill ${bill.file_name}`}
                    disabled={opening !== null}
                    onClick={async () => {
                      setOpening(bill.id);
                      try {
                        await viewSmallExpenseBill(bill);
                      } catch (error) {
                        toast.error(errMsg(error));
                      } finally {
                        setOpening(null);
                      }
                    }}
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                    {opening === bill.id ? "Opening…" : "View"}
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section className="min-w-0 space-y-2.5" aria-label="Expense history">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Record history
            </h3>
            <dl className="min-w-0 divide-y rounded-xl border bg-card">
              <InfoRow label="Recorded">{fmtDateTime(expense.created_at)}</InfoRow>
              <InfoRow label="Last edited">{fmtDateTime(expense.updated_at)}</InfoRow>
            </dl>
            {events.isLoading && (
              <p className="rounded-lg border p-3 text-xs text-muted-foreground" role="status">
                Loading activity…
              </p>
            )}
            {events.error && (
              <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-xs text-destructive">
                Could not load history: {errMsg(events.error)}
              </p>
            )}
            {!!events.data?.length && (
              <details className="min-w-0 rounded-xl border bg-card">
                <summary className="cursor-pointer p-3 text-sm font-medium">
                  Activity log ({events.data.length})
                </summary>
                <ol className="space-y-3 border-t p-3">
                  {events.data.map(event => (
                    <li key={event.id} className="min-w-0 rounded-lg border-l-2 border-muted-foreground/30 pl-3 text-xs">
                      <p className="font-semibold capitalize">{event.action.replace(/_/g, " ")}</p>
                      <time dateTime={event.created_at} className="mt-1 block text-muted-foreground">
                        {fmtDateTime(event.created_at)}
                      </time>
                      {event.reason && (
                        <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                          {event.reason}
                        </p>
                      )}
                      {event.action === "edited" && <EditSummary event={event} />}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>
        </main>

        <footer className="shrink-0 border-t bg-background px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-4">
          <Button
            type="button"
            onClick={onClose}
            variant="outline"
            className="h-11 w-full font-semibold sm:ml-auto sm:w-40"
          >
            Back to expenses
          </Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
