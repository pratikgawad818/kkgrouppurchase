import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  FileText,
  Layers,
  Plus,
  RefreshCw,
  ShoppingCart,
  Truck,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { orderedTasks, taskDue, type TaskGroup } from "@/lib/workspace-tasks";
import type { PurchaseChain } from "@/lib/purchase-pipeline";
import { PROJECT_STATUS_LABEL, inr, inrCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

export type WorkspaceProject = { id: string; name: string; city: string | null; status: string };
export type WorkspaceSnapshot = {
  tasks: PurchaseChain[];
  counts: Record<TaskGroup, number>;
  openOrders: number | null;
  deliveries: number | null;
  payable: number | null;
};
const taskIcons = {
  request: ClipboardList,
  rfq: FileText,
  order: ShoppingCart,
  invoice: FileText,
  payment: Wallet,
};

function shortDocumentNumber(value: string) {
  // The full document number is kept as a title and in the destination.
  // Only the repeated year is omitted in the compact mobile progress strip.
  return value.replace(/^([A-Z]+)-20\d{2}-/i, "$1-");
}

function PurchaseProgressRow({ task, today }: { task: PurchaseChain; today: string }) {
  const Icon = taskIcons[task.kind];
  const due = taskDue(task.due, today);
  return (
    <article className="min-w-0 border-b border-border/70 px-3 py-4 last:border-0 sm:px-5" aria-label={"Purchase " + task.number}>
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        <span className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
          task.group === "payments" ? "bg-amber-50 text-amber-700" : "bg-primary/10 text-primary",
        )} aria-hidden="true">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1 basis-[180px]">
          <Link to={task.href} className="block min-w-0 break-words text-sm font-semibold leading-5 text-foreground hover:text-primary hover:underline">
            {task.description}
            <span className="font-normal text-muted-foreground">{" · "}{task.project}</span>
          </Link>
        </div>
        {task.due && (
          <span className={cn(
            "shrink-0 rounded-lg border px-2 py-1 text-xs font-medium",
            due.tone === "overdue" ? "border-destructive/35 text-destructive"
              : due.tone === "today" ? "border-amber-300 text-amber-800"
                : "border-border text-muted-foreground",
          )}>
            Due {due.tone === "overdue" ? "overdue" : due.label}
          </span>
        )}
      </div>
      <div className="mt-3 flex w-full min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain pb-1.5 sm:flex-wrap" aria-label="Purchase document progress">
        {task.steps.map((step, index) => (
          <div className="flex shrink-0 items-center gap-1" key={step.key}>
            {index > 0 && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/55" aria-hidden="true" />}
            <span className={cn(
              "inline-flex min-h-8 max-w-[260px] items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium leading-4",
              step.state === "current" ? "border-primary/50 bg-primary/10 text-foreground ring-1 ring-primary/15"
                : step.state === "done" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-border bg-muted/35 text-muted-foreground",
            )} aria-label={step.label + " " + step.state}>
              {step.state === "done"
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                : step.state === "current"
                  ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  : null}
              {step.documents.length ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  {step.documents.map((item, docIndex) => (
                    <Link
                      key={item.href}
                      to={item.href}
                      title={item.number}
                      className="max-w-[130px] truncate underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {shortDocumentNumber(item.number)}
                      {docIndex < step.documents.length - 1 ? "," : ""}
                    </Link>
                  ))}
                  {step.key === "order" && task.vendor && (
                    <span className="max-w-[70px] truncate opacity-80" title={task.vendor}>
                      {task.vendor}
                    </span>
                  )}
                </span>
              ) : (
                <span>{step.label}</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 basis-[180px] break-words text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Now:</span>{" "}{task.stage}
        </p>
        <Link
          to={task.href}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-primary/25 bg-background px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {task.action}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

export function DailyWorkspace({
  projects,
  projectId,
  onProject,
  data,
  loading,
  error,
  onRetry,
  canCreate,
  canRequests,
  canOrders,
  canPayables,
  canPayments,
  canProjects,
  canStock,
  canInvoices,
  canRfqs,
  today,
  dateLabel,
  children,
}: {
  projects: WorkspaceProject[];
  projectId: string;
  onProject: (id: string) => void;
  data?: WorkspaceSnapshot | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  canCreate: boolean;
  canRequests: boolean;
  canPayments: boolean;
  canOrders: boolean;
  canPayables: boolean;
  canProjects: boolean;
  canStock: boolean;
  canInvoices: boolean;
  canRfqs: boolean;
  today: string;
  dateLabel: string;
  children?: ReactNode;
}) {
  const [filter, setFilter] = useState<TaskGroup | "all">("all");
  const tasks = orderedTasks(data?.tasks ?? [], filter);
  const count =
    filter === "all"
      ? (data?.counts.purchasing ?? 0) + (data?.counts.payments ?? 0)
      : (data?.counts[filter] ?? 0);
  const total = (data?.counts.purchasing ?? 0) + (data?.counts.payments ?? 0);
  const scopedProjects = projectId
    ? projects.filter((project) => project.id === projectId)
    : projects;
  const metric = (
    label: string,
    value: ReactNode,
    compact: ReactNode,
    href: string,
    Icon: typeof Truck,
    tone: string,
    exactAmount?: string,
  ) => (
    <Link
      to={href}
      className="daily-metric"
      title={exactAmount ? `${label}: ${exactAmount}` : undefined}
      aria-label={exactAmount ? `${label}: ${exactAmount}` : undefined}
    >
      <span className={cn("daily-metric-icon", tone)}>
        <Icon aria-hidden />
      </span>
      <span className="daily-metric-text">
        <span>{label}</span>
        <strong>
          <span className="daily-value-full">{value}</span>
          <span className="daily-value-compact whitespace-nowrap text-[clamp(16px,4.2vw,21px)]">{compact}</span>
        </strong>
      </span>
    </Link>
  );
  const unknown = error ? "Unavailable" : "—";
  const steps = [
    {
      label: "Request",
      href: "/procurement/purchase-requests",
      allowed: canRequests,
      icon: ClipboardList,
    },
    { label: "RFQ", href: "/procurement/rfqs", allowed: canRfqs, icon: FileText },
    {
      label: "Purchase order",
      href: "/procurement/purchase-orders",
      allowed: canOrders,
      icon: ShoppingCart,
    },
    { label: "Goods received", href: "/inventory/goods-received", allowed: canStock, icon: Truck },
    { label: "Invoice", href: "/finance/vendor-invoices", allowed: canInvoices, icon: FileText },
    { label: "Payment", href: "/finance/payments", allowed: canPayments, icon: Wallet },
  ];
  return (
    <div className="daily-workspace">
      <div className="daily-context">
        <label htmlFor="workspace-project">
          <Building2 aria-hidden />
          <span className="sr-only">Filter dashboard by project</span>
          <select
            id="workspace-project"
            value={projectId}
            onChange={(event) => onProject(event.target.value)}
            disabled={!projects.length}
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <span className="daily-context-note">Your workspace</span>
      </div>
      <div className="daily-heading">
        <div>
          <h1>Your day, organised.</h1>
          <p>{dateLabel}</p>
        </div>
        {canCreate && (
          <Button asChild size="lg" className="daily-create">
            <Link to="/procurement/purchase-requests/new">
              <Plus aria-hidden />
              New purchase request
            </Link>
          </Button>
        )}
      </div>
      <section className="daily-metrics" aria-label="Workspace totals" aria-busy={loading}>
        {canOrders &&
          metric(
            "Open orders",
            data?.openOrders ?? unknown,
            data?.openOrders ?? "—",
            "/procurement/purchase-orders",
            ShoppingCart,
            "teal",
          )}
        {canOrders &&
          metric(
            "Deliveries due",
            data?.deliveries ?? unknown,
            data?.deliveries ?? "—",
            "/procurement/follow-ups",
            Truck,
            "blue",
          )}
        {canPayables &&
          metric(
            "Vendor payables",
            data?.payable == null ? unknown : inr(data.payable),
            data?.payable == null ? "—" : inrCompact(data.payable),
            "/finance/payables",
            Wallet,
            "amber",
            data?.payable == null ? undefined : inr(data.payable),
          )}
        {!canOrders &&
          !canPayables &&
          metric(
            "Open work",
            data ? total : unknown,
            data ? total : "—",
            canRequests ? "/procurement/purchase-requests" : "/profile",
            ClipboardList,
            "teal",
          )}
      </section>
      {error && (
        <div className="daily-error" role="alert">
          <div>
            <strong>Your workspace could not refresh.</strong>
            <p>Totals and tasks are unavailable. Check your connection and try again.</p>
          </div>
          <Button variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden />
            Retry
          </Button>
        </div>
      )}
      <div className="daily-content-grid">
        <section
          className="daily-attention"
          aria-labelledby="attention-heading"
          aria-busy={loading}
        >
          <div className="daily-section-heading">
            <h2 id="attention-heading">
              Needs your attention {data && !error && <span className="daily-count">{total}</span>}
            </h2>
          </div>
          <div className="daily-tabs" role="group" aria-label="Filter open work">
            {(
              [
                { key: "all", label: "All" },
                { key: "purchasing", label: "Purchasing" },
                { key: "payments", label: "Payments" },
              ] as const
            )
              .filter(
                (tab) =>
                  tab.key === "all" ||
                  (tab.key === "purchasing"
                    ? canRequests || canOrders || canRfqs
                    : canInvoices || canPayments),
              )
              .map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  aria-pressed={filter === tab.key}
                  onClick={() => setFilter(tab.key)}
                  className={cn(filter === tab.key && "is-active")}
                >
                  {tab.label}
                  <span>
                    {data && !error ? (tab.key === "all" ? total : data.counts[tab.key]) : "—"}
                  </span>
                </button>
              ))}
          </div>
          {loading && (
            <div role="status" className="daily-task-loading">
              <span className="sr-only">Loading purchases…</span>
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse">
                  <span />
                  <span />
                </div>
              ))}
            </div>
          )}
          {!loading && !error && tasks.slice(0, 6).map((task) => (
            <PurchaseProgressRow key={task.id} task={task} today={today} />
          ))}
          {!loading && !error && tasks.length === 0 && (
            <div className="daily-empty">
              <CheckCircle2 aria-hidden />
              <h3>You’re all caught up</h3>
              <p>
                No open {filter === "all" ? "purchases" : `${filter} purchases`} in this project. New
                work will appear here.
              </p>
            </div>
          )}
          {error && (
            <div className="daily-empty">
              <p>Open work will appear here once your connection is restored.</p>
            </div>
          )}
          {data && !error && tasks.length > 0 && (
            <p className="daily-task-caption">
              Showing {Math.min(6, tasks.length)} of {count} active purchases. Open a
              module for the full register.
            </p>
          )}
        </section>
        {canProjects && (
          <section className="daily-projects" aria-labelledby="project-focus-heading">
            <div className="daily-section-heading">
              <h2 id="project-focus-heading">Project focus</h2>
              <Link to="/projects" aria-label="View all projects">
                <ArrowRight aria-hidden />
              </Link>
            </div>
            {scopedProjects.slice(0, 4).map((project) => (
              <Link to="/projects" key={project.id} className="daily-project">
                <span
                  className={cn(
                    "daily-project-icon",
                    project.status === "completed" ? "teal" : "blue",
                  )}
                >
                  {project.status === "completed" ? (
                    <CheckCircle2 aria-hidden />
                  ) : (
                    <Building2 aria-hidden />
                  )}
                </span>
                <span>
                  <strong>{project.name}</strong>
                  <small>
                    {PROJECT_STATUS_LABEL[project.status as keyof typeof PROJECT_STATUS_LABEL] ??
                      project.status.replaceAll("_", " ")}
                  </small>
                  {project.city && <small>{project.city}</small>}
                </span>
              </Link>
            ))}
            {scopedProjects.length === 0 && (
              <p className="p-5 text-sm text-muted-foreground">
                No projects available for this account.
              </p>
            )}
            <div className="daily-project-footer">
              <Layers aria-hidden />
              <span>Showing your accessible projects</span>
            </div>
          </section>
        )}
      </div>
      <section className="daily-workflow" aria-label="Procurement and payment workflow">
        <h2>From request to payment</h2>
        <div>
          {steps
            .filter((step) => step.allowed)
            .map((step, index) => (
              <span key={step.label}>
                {index > 0 && <ArrowRight aria-hidden className="daily-workflow-arrow" />}
                <Link to={step.href}>
                  <step.icon aria-hidden />
                  {step.label}
                </Link>
              </span>
            ))}
        </div>
      </section>
      {children}
    </div>
  );
}
