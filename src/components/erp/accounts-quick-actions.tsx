import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Banknote, BookOpen, FilePlus2, Landmark, ReceiptText, Wallet } from "lucide-react";
import { canAccessPage, type PageAccess } from "@/lib/page-access";

const tasks = [
  { to: "/finance/vendor-invoices/opening", title: "Enter old bill", detail: "Historical supplier bills without PO / GRN", icon: ReceiptText },
  { to: "/finance/vendor-invoices/new", title: "Enter PO invoice", detail: "Match accepted goods to supplier invoice", icon: FilePlus2 },
  { to: "/finance/vendor-invoices", title: "Review invoices", detail: "Find bills and check verification status", icon: BookOpen },
  { to: "/finance/payments", title: "Vendor payments", detail: "Schedule approvals and record payment", icon: Wallet },
  { to: "/finance/payables", title: "Outstanding bills", detail: "Review due dates and unpaid balances", icon: Banknote },
  { to: "/finance/vendor-ledger", title: "Vendor ledger", detail: "Check supplier account history", icon: BookOpen },
  { to: "/finance/small-expenses", title: "Small expenses", detail: "Record and review paid site expenses", icon: ReceiptText },
  { to: "/settings/bank-accounts", title: "Bank accounts", detail: "Maintain registered company accounts", icon: Landmark },
] as const;

export function AccountsQuickActions({ access }: { access: PageAccess }) {
  const allowed = tasks.filter(task => canAccessPage(task.to, access));
  if (!access.roles.includes("accounts_manager") || !allowed.length) return null;
  return <section aria-label="Accounts quick actions" className="rounded-2xl border bg-card p-4 shadow-card sm:p-5">
    <div className="mb-3">
      <h2 className="text-lg font-semibold">Accounts workspace</h2>
      <p className="text-sm text-muted-foreground">Start your daily entries, check outstanding bills and manage vendor payments.</p>
    </div>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {allowed.map(task => <Link key={task.to} to={task.to} className="group flex min-h-[84px] items-start gap-3 rounded-xl border p-3 transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><task.icon className="h-4 w-4" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1"><strong className="block text-sm">{task.title}</strong><span className="mt-1 block text-xs text-muted-foreground">{task.detail}</span></span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
      </Link>)}
    </div>
  </section>;
}
