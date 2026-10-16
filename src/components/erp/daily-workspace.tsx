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
import { orderedTasks, taskDue, type TaskGroup, type WorkspaceTask } from "@/lib/workspace-tasks";
import { PROJECT_STATUS_LABEL, inr, inrShort } from "@/lib/format";
import { cn } from "@/lib/utils";

export type WorkspaceProject = { id: string; name: string; city: string | null; status: string };
export type WorkspaceSnapshot = {
  tasks: WorkspaceTask[];
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
  ) => (
    <Link to={href} className="daily-metric">
      <span className={cn("daily-metric-icon", tone)}>
        <Icon aria-hidden />
      </span>
      <span className="daily-metric-text">
        <span>{label}</span>
        <strong>
          <span className="daily-value-full">{value}</span>
          <span className="daily-value-compact">{compact}</span>
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
            data?.payable == null ? "—" : inrShort(data.payable),
            "/finance/payables",
            Wallet,
            "amber",
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
          <div className="daily-task-head" aria-hidden>
            <span>Item</span>
            <span>Project</span>
            <span>Due</span>
            <span>Next step</span>
          </div>
          {loading && (
            <div role="status" className="daily-task-loading">
              <span className="sr-only">Loading your work…</span>
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse">
                  <span />
                  <span />
                </div>
              ))}
            </div>
          )}
          {!loading &&
            !error &&
            tasks.slice(0, 6).map((task) => {
              const Icon = taskIcons[task.kind];
              const due = taskDue(task.due, today);
              return (
                <div className="daily-task" key={`${task.kind}-${task.id}`}>
                  <span
                    className={cn(
                      "daily-task-icon",
                      task.group === "payments" ? "amber" : task.kind === "rfq" ? "blue" : "teal",
                    )}
                  >
                    <Icon aria-hidden />
                  </span>
                  <div className="daily-task-title">
                    <Link to={task.href}>{task.number}</Link>
                    <p>
                      {task.description}
                      <span className="daily-inline-project"> · {task.project}</span>
                    </p>
                  </div>
                  <span className="daily-task-project">{task.project}</span>
                  <span className={cn("daily-due", `due-${due.tone}`)}>{due.label}</span>
                  <Link className="daily-task-action" to={task.href}>
                    {task.action}
                    <ArrowRight aria-hidden />
                  </Link>
                </div>
              );
            })}
          {!loading && !error && tasks.length === 0 && (
            <div className="daily-empty">
              <CheckCircle2 aria-hidden />
              <h3>You’re all caught up</h3>
              <p>
                No open {filter === "all" ? "records" : `${filter} records`} in this project. New
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
              Showing {Math.min(6, tasks.length)} recent items from {count} open records. Open a
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
