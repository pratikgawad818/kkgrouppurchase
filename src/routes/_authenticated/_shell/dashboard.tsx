import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { canAccessPage } from "@/lib/page-access";
import { loadCompleteRows } from "@/lib/complete-register";
import { today } from "@/lib/finance";
import { fmtDate } from "@/lib/format";
import { Loading } from "@/components/erp/common";
import { DailyWorkspace, type WorkspaceSnapshot } from "@/components/erp/daily-workspace";
import { buildPurchaseChains, type PipePayment } from "@/lib/purchase-pipeline";
import { isSiteEngineerFieldPortal, siteEngineerAttentionTasks } from "@/lib/site-engineer-workflow";

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
  const isSiteEngineerPortal = isSiteEngineerFieldPortal(access.roles);
  // Even if an incorrect finance permission is ever granted, a field-only
  // engineer's dashboard must not fetch or expose supplier financial documents.
  const canInvoices = !isSiteEngineerPortal && can("/finance/vendor-invoices");
  const canPayments = !isSiteEngineerPortal && can("/finance/payments");
  const canPayables = !isSiteEngineerPortal && can("/finance/payables");
  const canChallans = can("/inventory/delivery-challans");
  const canGrns = can("/inventory/goods-received");
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
      "daily-workspace", "purchase-chains", me.data?.profile.id, effectiveProject, day,
      canPr, canRfqs, canPo, canChallans, canGrns,
      canInvoices, canPayments, canPayables, isSiteEngineerPortal,
    ],
    staleTime: 30_000,
    queryFn: async (): Promise<WorkspaceSnapshot> => {
      // Every accessible document family is read completely and with its
      // source keys. An eight-record sample cannot establish correct purchase
      // chains or counts (and could resurrect already-settled parent requests).
      // Each request remains independently restricted by RLS and page access.
      const prs = canPr
        ? loadCompleteRows(async (start, end) => {
          let query = supabase.from("purchase_requests")
            .select("id,pr_number,purpose,status,required_by,project_id,projects(name)", { count: "exact" })
            .order("id");
          if (effectiveProject) query = query.eq("project_id", effectiveProject);
          return await query.range(start, end);
        })
        : Promise.resolve([]);
      const rfqs = canRfqs
        ? loadCompleteRows(async (start, end) => {
          let query = supabase.from("rfqs")
            .select("id,rfq_number,status,response_due_date,purchase_request_id,project_id,projects(name)", { count: "exact" })
            .order("id");
          if (effectiveProject) query = query.eq("project_id", effectiveProject);
          return await query.range(start, end);
        })
        : Promise.resolve([]);
      const pos = canPo
        ? loadCompleteRows(async (start, end) => {
          let query = supabase.from("purchase_orders")
            .select("id,po_number,status,expected_delivery_date,purchase_request_id,rfq_id,project_id,projects(name),vendors(company_name)", { count: "exact" })
            .order("id");
          if (effectiveProject) query = query.eq("project_id", effectiveProject);
          return await query.range(start, end);
        })
        : Promise.resolve([]);
      const challans = canChallans
        ? loadCompleteRows(async (start, end) => {
          let query = supabase.from("vendor_delivery_challans")
            .select("id,challan_number,status,po_id,challan_date,project_id", { count: "exact" })
            .order("id");
          if (effectiveProject) query = query.eq("project_id", effectiveProject);
          return await query.range(start, end);
        })
        : Promise.resolve([]);
      const grns = canGrns
        ? loadCompleteRows(async (start, end) => {
          let query = supabase.from("goods_receipt_notes")
            .select("id,grn_number,status,po_id,received_date,project_id", { count: "exact" })
            .order("id");
          if (effectiveProject) query = query.eq("project_id", effectiveProject);
          return await query.range(start, end);
        })
        : Promise.resolve([]);
      const invoices = canInvoices
        ? loadCompleteRows(async (start, end) => {
          let query = supabase.from("vendor_invoices")
            .select("id,invoice_number,status,due_date,po_id,project_id,balance_due,amount_paid,advance_adjusted,projects(name),vendors(company_name)", { count: "exact" })
            .order("id");
          if (effectiveProject) query = query.eq("project_id", effectiveProject);
          return await query.range(start, end);
        })
        : Promise.resolve([]);
      // Payment may be company-wide (project_id = null) while its allocation
      // references a project-specific invoice. Fetch only RLS-visible payment
      // rows and restrict standalone items in the client after joining.
      const payments = canPayments
        ? loadCompleteRows(async (start, end) =>
          await supabase.from("vendor_payments")
            .select("id,payment_number,status,payment_date,project_id,projects(name),vendors(company_name)", { count: "exact" })
            .order("id").range(start, end))
        : Promise.resolve([]);
      const allocations = canPayments && canInvoices
        ? loadCompleteRows(async (start, end) =>
          await supabase.from("vendor_payment_allocations")
            .select("id,payment_id,invoice_id", { count: "exact" })
            .order("id").range(start, end))
        : Promise.resolve([]);

      const openQuery = supabase.from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .in("status", ["approved", "sent", "partially_received", "partially_accepted"]);
      const dueQuery = supabase.from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .in("status", ["approved", "sent", "partially_received", "partially_accepted"])
        .lte("expected_delivery_date", day);
      const openOrders = canPo
        ? (effectiveProject ? openQuery.eq("project_id", effectiveProject) : openQuery)
        : Promise.resolve({ count: null, error: null });
      const deliveriesDue = canPo
        ? (effectiveProject ? dueQuery.eq("project_id", effectiveProject) : dueQuery)
        : Promise.resolve({ count: null, error: null });
      // Financial KPI is intentionally unchanged and is distinct from the
      // purchase-chain tab counts.
      const payableRows = canPayables
        ? loadCompleteRows(async (start, end) => {
          let query = supabase.from("vendor_invoices")
            .select("id,balance_due", { count: "exact" })
            .in("status", ["approved", "partially_paid"])
            .order("id");
          if (effectiveProject) query = query.eq("project_id", effectiveProject);
          return await query.range(start, end);
        })
        : Promise.resolve([]);

      const [p, r, o, c, g, inv, pay, allocation, open, due, outstanding] =
        await Promise.all([
          prs, rfqs, pos, challans, grns, invoices, payments, allocations,
          openOrders, deliveriesDue, payableRows,
        ]);
      if ((canPo && (open.error || open.count === null || due.error || due.count === null))) {
        throw new Error("Open purchase-order counts could not be verified.");
      }

      const allocatedByPayment = new Map<string, string[]>();
      for (const link of allocation) {
        const ids = allocatedByPayment.get(link.payment_id) ?? [];
        ids.push(link.invoice_id);
        allocatedByPayment.set(link.payment_id, ids);
      }
      const invoiceIds = new Set(inv.map(item => item.id));
      const visiblePayments = pay.filter(row =>
        !effectiveProject ||
        row.project_id === effectiveProject ||
        (allocatedByPayment.get(row.id) ?? []).some(id => invoiceIds.has(id))
      );
      const paymentRows: PipePayment[] = visiblePayments.map(row => ({
        id: row.id, number: row.payment_number, status: row.status,
        due: row.payment_date,
        invoiceIds: (allocatedByPayment.get(row.id) ?? []).filter(id => invoiceIds.has(id)),
        vendor: row.vendors?.company_name ?? null,
        project: row.projects?.name ?? "Company-wide",
      }));

      const chainInput = {
        prs: p.map(row => ({
          id: row.id, number: row.pr_number, purpose: row.purpose,
          status: row.status, due: row.required_by,
          project: row.projects?.name ?? "Project",
        })),
        rfqs: r.map(row => ({
          id: row.id, number: row.rfq_number, status: row.status,
          due: row.response_due_date, prId: row.purchase_request_id,
          project: row.projects?.name ?? "Project",
        })),
        pos: o.map(row => ({
          id: row.id, number: row.po_number, status: row.status,
          due: row.expected_delivery_date,
          prId: row.purchase_request_id, rfqId: row.rfq_id,
          vendor: row.vendors?.company_name ?? null,
          project: row.projects?.name ?? "Project",
        })),
        challans: c.map(row => ({
          id: row.id, number: row.challan_number, status: row.status,
          poId: row.po_id, date: row.challan_date,
        })),
        grns: g.map(row => ({
          id: row.id, number: row.grn_number, status: row.status,
          poId: row.po_id, date: row.received_date,
        })),
        invoices: inv.map(row => ({
          id: row.id, number: row.invoice_number, status: row.status,
          due: row.due_date, poId: row.po_id,
          vendor: row.vendors?.company_name ?? null,
          project: row.projects?.name ?? "Project",
          balanceDue: Number(row.balance_due),
          amountPaid: Number(row.amount_paid),
          advanceAdjusted: Number(row.advance_adjusted),
        })),
        payments: paymentRows,
      };
      const allTasks = buildPurchaseChains(chainInput);
      const tasks = isSiteEngineerPortal
        ? siteEngineerAttentionTasks(allTasks, chainInput)
        : allTasks;
      const payable = outstanding.reduce((sum, row) => {
        const value = Number(row.balance_due);
        if (!Number.isFinite(value)) throw new Error("Payable totals could not be verified.");
        return sum + value;
      }, 0);
      return {
        tasks,
        // Tabs count PURCHASES (not the number of linked documents).
        counts: {
          purchasing: tasks.filter(t => t.group === "purchasing").length,
          payments: tasks.filter(t => t.group === "payments").length,
        },
        openOrders: canPo ? open.count : null,
        deliveries: canPo ? due.count : null,
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
      isSiteEngineerPortal={isSiteEngineerPortal}
      today={day}
      dateLabel={new Intl.DateTimeFormat("en-GB", {
        weekday: "long", timeZone: "Asia/Kolkata",
      }).format(new Date()) + ", " + fmtDate(new Date().toISOString())}
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
