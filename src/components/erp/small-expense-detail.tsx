import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FileImage, FileText, Eye } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtDate, fmtDateTime, inr, errMsg } from "@/lib/format";
import { SMALL_EXPENSE_CATEGORIES, SMALL_EXPENSE_PAYMENTS } from "@/lib/small-expenses";
import { viewSmallExpenseBill, type ExpenseBill } from "@/lib/small-expense-bills";

// Additive table introduced in migration 0077; keep compatibility with the
// existing generated client until regeneration against the deployed schema.
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

export async function getSmallExpenseBills(expenseId: string): Promise<ExpenseBill[]> {
  const { data, error } = await billsDb.from("site_small_expense_bills")
    .select("id,expense_id,storage_path,file_name,mime_type,byte_size,created_at,is_active")
    .eq("expense_id", expenseId).eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ExpenseBill[];
}

export function SmallExpenseDetail({
  expense, onClose,
}: {
  expense: SmallExpenseRecord | null;
  onClose: () => void;
}) {
  const [opening, setOpening] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["small-expense-detail", expense?.id],
    enabled: !!expense,
    queryFn: async () => {
      const [bills, events] = await Promise.all([
        getSmallExpenseBills(expense!.id),
        billsDb.from("site_small_expense_events")
          .select("id,action,reason,actor_id,created_at,before_values,after_values")
          .eq("expense_id", expense!.id)
          .order("created_at", { ascending: false }).limit(50),
      ]);
      if (events.error) throw events.error;
      return { bills, events: (events.data ?? []) as ExpenseEvent[] };
    },
  });
  const info = (label: string, content: React.ReactNode) => (
    <div className="rounded-lg border bg-muted/20 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{content || "—"}</dd>
    </div>
  );
  return (
    <Dialog open={!!expense} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Eye className="h-5 w-5"/>View expense</DialogTitle>
          <DialogDescription>
            Read-only details. Viewing an expense never changes it or creates a correction.
          </DialogDescription>
        </DialogHeader>
        {expense && (
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-xs text-muted-foreground">Expense amount</div>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{inr(expense.amount)}</p>
              <div className="mt-1 text-sm text-muted-foreground">
                Paid to {expense.paid_to} · {fmtDate(expense.spent_on)}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              {info("Project", expense.projects?.name ?? "General office")}
              {info("Building / wing", expense.buildings?.name ?? "General")}
              {info("Category", (SMALL_EXPENSE_CATEGORIES as Record<string,string>)[expense.category] ?? expense.category)}
              {info("Paid through", (SMALL_EXPENSE_PAYMENTS as Record<string,string>)[expense.payment_method] ?? expense.payment_method)}
              {expense.other_category_detail && info("Other category detail", expense.other_category_detail)}
              {info("Bill / receipt reference", expense.receipt_reference ?? "Not provided")}
              {info("Recorded on", fmtDateTime(expense.created_at))}
              {info("Last changed", fmtDateTime(expense.updated_at))}
            </dl>
            <div>
              <h3 className="text-sm font-semibold">Expense details</h3>
              <p className="mt-1 whitespace-pre-wrap break-words rounded-lg border p-3 text-sm">{expense.description}</p>
            </div>
            <section>
              <h3 className="mb-2 text-sm font-semibold">
                Bill images & receipts {detail.data ? `(${detail.data.bills.length})` : ""}
              </h3>
              {detail.isLoading && <p className="text-xs text-muted-foreground">Loading private bills…</p>}
              {detail.error && <p role="alert" className="text-sm text-destructive">{errMsg(detail.error)}</p>}
              {detail.data?.bills.length === 0 && <p className="rounded-lg border p-3 text-xs text-muted-foreground">No bill images or PDFs attached.</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {detail.data?.bills.map((bill) => (
                  <div key={bill.id} className="flex min-w-0 items-center gap-2 rounded-lg border p-2">
                    {bill.mime_type === "application/pdf" ? <FileText className="h-4 w-4 shrink-0"/> : <FileImage className="h-4 w-4 shrink-0"/>}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium" title={bill.file_name}>{bill.file_name}</div>
                      <div className="text-[11px] text-muted-foreground">{Math.ceil(bill.byte_size / 1024)} KB</div>
                    </div>
                    <Button type="button" size="sm" variant="outline" disabled={!!opening}
                      onClick={async () => {
                        setOpening(bill.id);
                        try { await viewSmallExpenseBill(bill); }
                        catch (error) { toast.error(errMsg(error)); }
                        finally { setOpening(null); }
                      }}>
                      {opening === bill.id ? "Opening…" : "View"}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
            {detail.data?.events.length ? (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">Recorded activity ({detail.data.events.length})</summary>
                <ol className="mt-3 space-y-2 border-l pl-4">
                  {detail.data.events.map((event) => (
                    <li key={event.id} className="text-xs">
                      <span className="font-medium capitalize">{event.action.replace(/_/g," ")}</span>
                      <span className="ml-2 text-muted-foreground">{fmtDateTime(event.created_at)}</span>
                      {event.reason && <div className="mt-0.5 break-words">{event.reason}</div>}
                      {event.action === "edited" && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-primary">View edit history</summary>
                          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 text-[10px]">
                            {JSON.stringify({ before: event.before_values, after: event.after_values }, null, 2)}
                          </pre>
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
