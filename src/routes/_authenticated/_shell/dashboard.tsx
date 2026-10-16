import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { canAccessPage } from "@/lib/page-access";
import { loadCompleteRows } from "@/lib/complete-register";
import { today } from "@/lib/finance";
import { Loading } from "@/components/erp/common";
import { DailyWorkspace, type WorkspaceSnapshot } from "@/components/erp/daily-workspace";
import type { WorkspaceTask } from "@/lib/workspace-tasks";

const DetailedDashboard = lazy(() => import("@/components/erp/detailed-dashboard"));
export const Route = createFileRoute("/_authenticated/_shell/dashboard")({
  head: () => ({
    meta: [
      { title: "Your workspace — KK GROUP ERP" },
      {
        name: "description",
        content: "Your purchase requests, orders, deliveries and vendor payments in one workspace.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const me = useMe();
  const [projectId, setProjectId] = useState("");
  const [detailed, setDetailed] = useState(false);
  const access = {
    roles: me.data?.roles ?? [],
    permissions: me.data?.permissions ?? new Set<string>(),
  };
  const can = (path: string) => canAccessPage(path, access);
  const canPr = can("/procurement/purchase-requests");
  const canRfqs = can("/procurement/rfqs");
  const canPo = can("/procurement/purchase-orders");
  const canInvoices = can("/finance/vendor-invoices");
  const canPayments = can("/finance/payments");
  const canPayables = can("/finance/payables");
  const canProjects = can("/projects");
  const day = today();
  const projects = useQuery({
    queryKey: ["workspace-projects", me.data?.profile.id],
    enabled: canProjects,
    staleTime: 60_000,
    queryFn: () =>
      loadCompleteRows(
        async (start, end) =>
          await supabase
            .from("projects")
            .select("id,name,city,status", { count: "exact" })
            .order("name")
            .order("id")
            .range(start, end),
      ),
  });
  const effectiveProject =
    projects.data && !projects.data.some((project) => project.id === projectId) ? "" : projectId;
  const q = useQuery({
    queryKey: [
      "daily-workspace",
      me.data?.profile.id,
      effectiveProject,
      day,
      canPr,
      canRfqs,
      canPo,
      canInvoices,
      canPayments,
      canPayables,
    ],
    staleTime: 30_000,
    queryFn: async (): Promise<WorkspaceSnapshot> => {
      const noRows = { data: [], count: 0, error: null };
      const pr = supabase
        .from("purchase_requests")
        .select("id,pr_number,purpose,status,required_by,projects(name)", { count: "exact" })
        .in("status", ["draft", "pending_approval", "approved"])
        .order("required_by")
        .order("id")
        .limit(8);
      const rfq = supabase
        .from("rfqs")
        .select("id,rfq_number,status,response_due_date,projects(name)", { count: "exact" })
        .in("status", ["draft", "sent", "partially_responded", "fully_responded", "ready_for_po"])
        .order("response_due_date")
        .order("id")
        .limit(8);
      const po = supabase
        .from("purchase_orders")
        .select("id,po_number,status,expected_delivery_date,projects(name),vendors(company_name)", {
          count: "exact",
        })
        .in("status", [
          "draft",
          "pending_approval",
          "approved",
          "sent",
          "partially_received",
          "partially_accepted",
        ])
        .order("expected_delivery_date", { nullsFirst: false })
        .order("id")
        .limit(8);
      const invoices = supabase
        .from("vendor_invoices")
        .select("id,invoice_number,status,due_date,projects(name),vendors(company_name)", {
          count: "exact",
        })
        .in("status", ["draft", "pending_review", "exception", "approved", "partially_paid"])
        .order("due_date", { nullsFirst: false })
        .order("id")
        .limit(8);
      const payments = supabase
        .from("vendor_payments")
        .select("id,payment_number,status,payment_date,projects(name),vendors(company_name)", {
          count: "exact",
        })
        .in("status", ["scheduled", "approved"])
        .order("payment_date")
        .order("id")
        .limit(8);
      const open = supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .in("status", ["approved", "sent", "partially_received", "partially_accepted"]);
      const deliveries = supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .in("status", ["approved", "sent", "partially_received", "partially_accepted"])
        .lte("expected_delivery_date", day);
      const balances = supabase
        .from("vendor_invoices")
        .select("id,balance_due", { count: "exact" })
        .in("status", ["approved", "partially_paid"])
        .order("id");
      // Each independently permissioned request is still subject to company/project RLS.
      const [p, r, o, i, pay, openCount, dueCount, payableRows] = await Promise.all([
        canPr ? (effectiveProject ? pr.eq("project_id", effectiveProject) : pr) : noRows,
        canRfqs ? (effectiveProject ? rfq.eq("project_id", effectiveProject) : rfq) : noRows,
        canPo ? (effectiveProject ? po.eq("project_id", effectiveProject) : po) : noRows,
        canInvoices
          ? effectiveProject
            ? invoices.eq("project_id", effectiveProject)
            : invoices
          : noRows,
        canPayments
          ? effectiveProject
            ? payments.eq("project_id", effectiveProject)
            : payments
          : noRows,
        canPo ? (effectiveProject ? open.eq("project_id", effectiveProject) : open) : noRows,
        canPo
          ? effectiveProject
            ? deliveries.eq("project_id", effectiveProject)
            : deliveries
          : noRows,
        canPayables
          ? loadCompleteRows(
              async (start, end) =>
                await (
                  effectiveProject ? balances.eq("project_id", effectiveProject) : balances
                ).range(start, end),
            )
          : [],
      ]);
      for (const result of [p, r, o, i, pay, openCount, dueCount])
        if (result.error || result.count === null)
          throw new Error("Open work could not be verified.");
      const tasks: WorkspaceTask[] = [
        ...(p.data ?? []).map((row) => ({
          id: row.id,
          kind: "request" as const,
          group: "purchasing" as const,
          number: row.pr_number,
          description: row.purpose || "Purchase request",
          project: row.projects?.name ?? "Project",
          due: row.required_by,
          action: row.status === "draft" ? "Finish request" : "View request",
          href: `/procurement/purchase-requests/${row.id}`,
        })),
        ...(r.data ?? []).map((row) => ({
          id: row.id,
          kind: "rfq" as const,
          group: "purchasing" as const,
          number: row.rfq_number,
          description:
            row.status === "ready_for_po" ? "Ready for purchase order" : "RFQ & quotations",
          project: row.projects?.name ?? "Project",
          due: row.response_due_date,
          action: "View RFQ",
          href: `/procurement/rfqs/${row.id}`,
        })),
        ...(o.data ?? []).map((row) => ({
          id: row.id,
          kind: "order" as const,
          group: "purchasing" as const,
          number: row.po_number,
          description: row.vendors?.company_name ?? "Purchase order",
          project: row.projects?.name ?? "Project",
          due: row.expected_delivery_date,
          action: "View order",
          href: `/procurement/purchase-orders/${row.id}`,
        })),
        ...(i.data ?? []).map((row) => ({
          id: row.id,
          kind: "invoice" as const,
          group: "payments" as const,
          number: row.invoice_number,
          description: row.vendors?.company_name ?? "Vendor invoice",
          project: row.projects?.name ?? "Project",
          due: row.due_date,
          action: "View invoice",
          href: `/finance/vendor-invoices/${row.id}`,
        })),
        ...(pay.data ?? []).map((row) => ({
          id: row.id,
          kind: "payment" as const,
          group: "payments" as const,
          number: row.payment_number,
          description: row.vendors?.company_name ?? "Vendor payment",
          project: row.projects?.name ?? "Company-wide",
          due: row.payment_date,
          action: "View payment",
          href: `/finance/payments/${row.id}`,
        })),
      ];
      const payable = payableRows.reduce((sum, row) => {
        const value = Number(row.balance_due);
        if (!Number.isFinite(value)) throw new Error("Payable totals could not be verified.");
        return sum + value;
      }, 0);
      return {
        tasks,
        counts: { purchasing: p.count! + r.count! + o.count!, payments: i.count! + pay.count! },
        openOrders: canPo ? openCount.count : null,
        deliveries: canPo ? dueCount.count : null,
        payable: canPayables ? payable : null,
      };
    },
  });
  return (
    <DailyWorkspace
      projects={projects.data ?? []}
      projectId={effectiveProject}
      onProject={setProjectId}
      data={q.isError ? undefined : q.data}
      loading={q.isPending}
      error={q.isError}
      onRetry={() => {
        void q.refetch();
        void projects.refetch();
      }}
      canCreate={can("/procurement/purchase-requests/new")}
      canRequests={canPr}
      canOrders={canPo}
      canPayables={canPayables}
      canPayments={canPayments}
      canProjects={canProjects}
      canStock={can("/inventory/goods-received")}
      canInvoices={canInvoices}
      canRfqs={canRfqs}
      today={day}
      dateLabel={new Intl.DateTimeFormat("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }).format(new Date())}
    >
      {projects.isError && (
        <div role="alert" className="daily-error">
          <p>Projects could not load. Your work remains available without a project filter.</p>
          <button
            type="button"
            onClick={() => void projects.refetch()}
            className="text-primary font-semibold"
          >
            Retry projects
          </button>
        </div>
      )}
      <div className="daily-details">
        <button
          type="button"
          aria-expanded={detailed}
          aria-controls="detailed-workspace"
          onClick={() => setDetailed((value) => !value)}
        >
          <span>
            <strong>Detailed overview</strong>
            <small>Financial year, buildings, stock health and activity</small>
          </span>
          <ChevronDown aria-hidden className={detailed ? "rotate-180" : ""} />
        </button>
        {detailed && (
          <div id="detailed-workspace">
            <Suspense fallback={<Loading />}>
              <DetailedDashboard />
            </Suspense>
          </div>
        )}
      </div>
    </DailyWorkspace>
  );
}
