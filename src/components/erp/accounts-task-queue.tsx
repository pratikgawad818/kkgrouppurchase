import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { canAccessPage, type PageAccess } from "@/lib/page-access";
import { Button } from "@/components/ui/button";

const invoiceTasks = [
  { status: "draft", title: "Incomplete invoices", detail: "Finish entry and submit for matching" },
  { status: "exception", title: "Invoice exceptions", detail: "Review mismatches and correct details" },
  { status: "pending_review", title: "Awaiting invoice verification", detail: "Includes bills awaiting another authorized reviewer" },
] as const;
const paymentTasks = [
  { status: "scheduled", title: "Awaiting payment approval", detail: "Track requests awaiting Director approval" },
  { status: "approved", title: "Approved payments to record", detail: "Record only after the actual payment is made" },
] as const;

async function exactCount(request: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count, error } = await request;
  if (error) throw new Error(error.message);
  if (count === null || !Number.isSafeInteger(count) || count < 0) throw new Error("Task count could not be verified");
  return count;
}

export function AccountsTaskQueue({ access, userId }: { access: PageAccess; userId: string }) {
  const isAccounts = access.roles.includes("accounts_manager");
  const canInvoices = isAccounts && canAccessPage("/finance/vendor-invoices", access);
  const canPayments = isAccounts && canAccessPage("/finance/payments", access);
  const query = useQuery({
    queryKey: ["accounts-task-queue", userId, canInvoices, canPayments],
    enabled: !!userId && (canInvoices || canPayments),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      // Exact head-only RLS-scoped counts; no download of complete registers.
      const invoices = canInvoices ? Promise.all(invoiceTasks.map(async task => ({
        ...task,
        count: await exactCount(supabase.from("vendor_invoices").select("id", { count: "exact", head: true }).eq("status", task.status)),
      }))) : Promise.resolve([]);
      const payments = canPayments ? Promise.all(paymentTasks.map(async task => ({
        ...task,
        count: await exactCount(supabase.from("vendor_payments").select("id", { count: "exact", head: true }).eq("status", task.status)),
      }))) : Promise.resolve([]);
      const [invoiceRows, paymentRows] = await Promise.all([invoices, payments]);
      return { invoiceRows, paymentRows };
    },
  });
  if (!isAccounts || (!canInvoices && !canPayments)) return null;
  return <section aria-label="Daily Accounts task queue" className="rounded-2xl border bg-card p-4 shadow-card sm:p-5">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-lg font-semibold">Daily Accounts tasks</h2>
        <p className="text-xs text-muted-foreground">All accessible projects · open work across the register, independent of the overview project filter.</p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
        <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />Refresh
      </Button>
    </div>
    {query.isError ? <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">Task counts could not be verified. Refresh to retry.</p>
      : query.isPending ? <p role="status" className="text-sm text-muted-foreground">Checking current invoice and payment statuses…</p>
      : <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {query.data?.invoiceRows.map(task => <Link key={task.status} to="/finance/vendor-invoices" search={{ status: task.status }}
          className="flex items-start gap-3 rounded-xl border p-3 hover:bg-muted/40 focus-visible:outline focus-visible:outline-primary">
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">{task.title}</p><p className="mt-1 text-xs text-muted-foreground">{task.detail}</p></div>
          <span className="text-xl font-semibold tabular-nums">{task.count}</span><ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
        </Link>)}
        {query.data?.paymentRows.map(task => <Link key={task.status} to="/finance/payments" search={{ status: task.status }}
          className="flex items-start gap-3 rounded-xl border p-3 hover:bg-muted/40 focus-visible:outline focus-visible:outline-primary">
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">{task.title}</p><p className="mt-1 text-xs text-muted-foreground">{task.detail}</p></div>
          <span className="text-xl font-semibold tabular-nums">{task.count}</span><ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
        </Link>)}
      </div>}
    {query.isFetching && !query.isPending && <p role="status" className="mt-2 text-xs text-muted-foreground">Refreshing counts…</p>}
  </section>;
}
