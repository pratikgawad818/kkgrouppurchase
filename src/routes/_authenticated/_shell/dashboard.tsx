import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  ClipboardList,
  Clock,
  IndianRupee,
  Package,
  Plus,
  ShoppingCart,
  Store,
  Users,
  Wallet,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FirstRunSetup } from "@/components/erp/first-run-setup";
import { supabase } from "@/integrations/supabase/client";
import { Stat, Loading } from "@/components/erp/common";
import { fmtDateTime, PROJECT_STATUS_LABEL } from "@/lib/format";
import { useCan } from "@/lib/session";
import { ACTIVE_DELIVERY_PO_STATUSES, purchaseOrderLineValues } from "@/lib/procurement-followup";
import { today as todayIst } from "@/lib/finance";
import { loadCompleteRows } from "@/lib/complete-register";
import { summarizeDashboardStock } from "@/lib/dashboard-stock";
import { watchDashboardSection } from "@/lib/dashboard-viewport";

export const Route = createFileRoute("/_authenticated/_shell/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — KK GROUP ERP" },
      { name: "description", content: "Procurement, inventory, vendor and project overview." },
      { property: "og:title", content: "Dashboard — KK GROUP ERP" },
      {
        property: "og:description",
        content: "Procurement, inventory, vendor and project overview.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function fyOf(d: Date) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return y;
}
function fyLabel(y: number) {
  return `FY ${y}–${String(y + 1).slice(2)}`;
}
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

function Pending({ label }: { label: string; phase?: number }) {
  return (
    <div className="h-full rounded-xl border border-dashed bg-muted/30 p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">Not available for this account</div>
    </div>
  );
}

/** Load secondary queries near viewport rather than blocking dashboard first paint. */
function DeferredDashboardSection({
  label,
  minHeight = 180,
  children,
}: {
  label: string;
  minHeight?: number;
  children: ReactNode;
}) {
  const target = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (active || !target.current) return;
    return watchDashboardSection(target.current, () => setActive(true));
  }, [active]);
  return (
    <div ref={target} className="min-w-0" style={active ? undefined : { minHeight }}>
      {active ? (
        children
      ) : (
        <div className="mt-8 flex min-h-32 flex-col items-start justify-center gap-2 rounded-xl border border-dashed bg-muted/20 p-4">
          <p className="text-sm font-medium">{label}</p>
          <button
            type="button"
            onClick={() => setActive(true)}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
          >
            Load this section
          </button>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-baseline gap-2 text-[15px] font-semibold tracking-tight">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">{children}</div>
    </section>
  );
}

function PrSummary({
  fy,
  projectId,
  buildingId,
  canCreate,
}: {
  fy: number;
  projectId: string;
  buildingId: string;
  canCreate: boolean;
}) {
  const q = useQuery({
    queryKey: ["prs", "summary", fy, projectId, buildingId],
    queryFn: async () => {
      let r = supabase
        .from("purchase_requests")
        .select("id,status,required_by", { count: "exact" })
        .order("id")
        .gte("request_date", `${fy}-04-01`)
        .lte("request_date", `${fy + 1}-03-31`);
      if (projectId) r = r.eq("project_id", projectId);
      if (buildingId) r = r.eq("building_id", buildingId);
      const data = await loadCompleteRows(
        async (start, end) => await r.order("id").range(start, end),
      );
      const soon = new Date();
      soon.setDate(soon.getDate() + 7);
      const s = soon.toISOString().slice(0, 10);
      const rows = data ?? [];
      const c = (st: string) => rows.filter((x) => x.status === st).length;
      return {
        total: rows.length,
        draft: c("draft"),
        pending: c("pending_approval"),
        approved: c("approved"),
        rejected: c("rejected"),
        due: rows.filter(
          (x) => ["draft", "pending_approval", "approved"].includes(x.status) && x.required_by <= s,
        ).length,
      };
    },
  });
  if (q.isError)
    return (
      <div
        role="alert"
        className="mt-4 rounded-xl border border-destructive/30 p-4 text-sm text-destructive"
      >
        This summary is unavailable.{" "}
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          Retry
        </Button>
      </div>
    );
  const d = q.data;
  const card = (
    label: string,
    value: number | undefined,
    search: { status?: string; due?: string },
  ) => (
    <Link to="/procurement/purchase-requests" search={search}>
      <Stat
        label={label}
        value={value ?? "—"}
        className="hover:border-primary/40 hover:shadow-md"
      />
    </Link>
  );
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight">
          Purchase Requests{" "}
          <span className="font-normal text-muted-foreground">
            · {d?.total ?? "—"} total in {fyLabel(fy)}
          </span>
        </h2>
        {canCreate && (
          <Button asChild size="sm">
            <Link to="/procurement/purchase-requests/new">
              <Plus className="h-4 w-4" />
              Purchase Request
            </Link>
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {card("Draft", d?.draft, { status: "draft" })}
        {card("Pending approval", d?.pending, { status: "pending_approval" })}
        {card("Approved", d?.approved, { status: "approved" })}
        {card("Rejected", d?.rejected, { status: "rejected" })}
        {card("Due in 7 days", d?.due, { due: "1" })}
      </div>
    </section>
  );
}

function PoSummary({
  fy,
  projectId,
  buildingId,
}: {
  fy: number;
  projectId: string;
  buildingId: string;
}) {
  const q = useQuery({
    queryKey: ["pos", "summary", fy, projectId, buildingId],
    queryFn: async () => {
      let r = supabase
        .from("purchase_orders")
        .select(
          "id,status,grand_total,purchase_order_items(ordered_quantity,accepted_quantity,short_closed_quantity,line_total)",
          { count: "exact" },
        )
        .order("id")
        .gte("po_date", `${fy}-04-01`)
        .lte("po_date", `${fy + 1}-03-31`);
      if (projectId) r = r.eq("project_id", projectId);
      if (buildingId) r = r.eq("building_id", buildingId);
      const data = await loadCompleteRows(
        async (start, end) => await r.order("id").range(start, end),
      );
      const rows = data ?? [];
      const c = (st: string) => rows.filter((x) => x.status === st).length;
      // Undelivered PO line commitments are based on ACCEPTED stock, not raw
      // received units (which can include damaged/rejected goods). Short-closed
      // quantities are no longer due from the vendor.
      const pendingValue = rows
        .filter((po) => ACTIVE_DELIVERY_PO_STATUSES.some((status) => status === po.status))
        .reduce(
          (sum, po) =>
            sum + purchaseOrderLineValues(po.purchase_order_items).estimatedOpenLineValue,
          0,
        );
      return {
        total: rows.length,
        pending: c("pending_approval"),
        approved: c("approved"),
        sent: c("sent"),
        partial: c("partially_received") + c("partially_accepted"),
        full: c("fully_received"),
        pendingValue,
      };
    },
  });
  if (q.isError)
    return (
      <div
        role="alert"
        className="mt-4 rounded-xl border border-destructive/30 p-4 text-sm text-destructive"
      >
        This summary is unavailable.{" "}
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          Retry
        </Button>
      </div>
    );
  const d = q.data;
  const card = (label: string, value: React.ReactNode, hint?: string) => (
    <Link to="/procurement/purchase-orders">
      <Stat
        label={label}
        value={value ?? "—"}
        hint={hint}
        className="hover:border-primary/40 hover:shadow-md"
      />
    </Link>
  );
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-baseline gap-2 text-[15px] font-semibold tracking-tight">
        Purchase Orders{" "}
        <span className="font-normal text-muted-foreground">
          · {d?.total ?? "—"} in {fyLabel(fy)}
        </span>
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {card("Pending approval", d?.pending)}
        {card("Approved", d?.approved)}
        {card("Sent", d?.sent)}
        {card("Partially received", d?.partial)}
        {card("Fully received", d?.full)}
        {card(
          "Open PO line value¹",
          d ? inr(d.pendingValue) : undefined,
          "Undelivered accepted-material commitment",
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        ¹ Estimated outstanding material line value after accepted GRNs and short-closures. Excludes
        PO-level charges and discounts; it is not a vendor payable.
      </p>
    </section>
  );
}

function GrnSummary({
  fy,
  projectId,
  buildingId,
}: {
  fy: number;
  projectId: string;
  buildingId: string;
}) {
  const q = useQuery({
    queryKey: ["grns", "summary", fy, projectId, buildingId],
    queryFn: async () => {
      let r = supabase
        .from("goods_receipt_notes")
        .select("id,grn_number,received_date,status,vendors(company_name)", { count: "exact" })
        .neq("status", "cancelled")
        .gte("received_date", `${fy}-04-01`)
        .lte("received_date", `${fy + 1}-03-31`)
        .order("created_at", { ascending: false });
      if (projectId) r = r.eq("project_id", projectId);
      if (buildingId) r = r.eq("building_id", buildingId);
      const data = await loadCompleteRows(
        async (start, end) => await r.order("id").range(start, end),
      );
      const m = todayIst().slice(0, 7);
      const rows = data ?? [];
      return {
        fy: rows.length,
        month: rows.filter((x) => x.received_date.startsWith(m)).length,
        drafts: rows.filter((x) => x.status === "draft").length,
        recent: rows.slice(0, 5),
      };
    },
  });
  if (q.isError)
    return (
      <div
        role="alert"
        className="mt-4 rounded-xl border border-destructive/30 p-4 text-sm text-destructive"
      >
        This summary is unavailable.{" "}
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          Retry
        </Button>
      </div>
    );
  const d = q.data;
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-baseline gap-2 text-[15px] font-semibold tracking-tight">
        Goods Received
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link to="/inventory/goods-received">
          <Stat
            label="This month"
            value={d?.month ?? "—"}
            className="hover:border-primary/40 hover:shadow-md"
          />
        </Link>
        <Link to="/inventory/goods-received">
          <Stat
            label={fyLabel(fy)}
            value={d?.fy ?? "—"}
            className="hover:border-primary/40 hover:shadow-md"
          />
        </Link>
        <Link to="/inventory/goods-received">
          <Stat
            label="Drafts awaiting posting"
            value={d?.drafts ?? "—"}
            className="hover:border-primary/40 hover:shadow-md"
          />
        </Link>
        <div className="col-span-2 rounded-xl border bg-card p-4 text-xs shadow-card sm:col-span-1">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Recent GRNs
          </div>
          {d?.recent.length ? (
            d.recent.map((g) => (
              <div key={g.id} className="flex justify-between">
                <Link
                  className="font-mono text-primary hover:underline"
                  to="/inventory/goods-received/$id"
                  params={{ id: g.id }}
                >
                  {g.grn_number}
                </Link>
                <span className="truncate pl-2 text-muted-foreground">
                  {g.vendors?.company_name}
                </span>
              </div>
            ))
          ) : (
            <div className="text-muted-foreground">None yet</div>
          )}
        </div>
      </div>
    </section>
  );
}

function ApCards() {
  const q = useQuery({
    queryKey: ["payables", "summary"],
    queryFn: async () => {
      const t = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      const [i, p] = await Promise.all([
        loadCompleteRows(
          async (start, end) =>
            await supabase
              .from("vendor_invoices")
              .select("id,status,balance_due,due_date", { count: "exact" })
              .in("status", ["approved", "partially_paid", "pending_review", "exception"])
              .order("id")
              .range(start, end),
        ),
        loadCompleteRows(
          async (start, end) =>
            await supabase
              .from("vendor_payments")
              .select("id,amount", { count: "exact" })
              .eq("status", "recorded")
              .gte("payment_date", t.slice(0, 8) + "01")
              .order("id")
              .range(start, end),
        ),
      ]);
      const rows = i;
      const open = rows.filter((x) => x.status === "approved" || x.status === "partially_paid");
      return {
        outstanding: open.reduce((a, x) => a + Number(x.balance_due), 0),
        overdue: open
          .filter((x) => x.due_date && x.due_date < t)
          .reduce((a, x) => a + Number(x.balance_due), 0),
        overdueN: open.filter((x) => x.due_date && x.due_date < t).length,
        pending: rows.filter((x) => x.status === "pending_review").length,
        exceptions: rows.filter((x) => x.status === "exception").length,
        paid: p.reduce((a, x) => a + Number(x.amount), 0),
      };
    },
  });
  if (q.isError)
    return (
      <div
        role="alert"
        className="mt-4 rounded-xl border border-destructive/30 p-4 text-sm text-destructive"
      >
        This summary is unavailable.{" "}
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          Retry
        </Button>
      </div>
    );
  const d = q.data;
  return (
    <>
      <Link to="/finance/payables">
        <Stat
          label="Vendor payables"
          value={d ? inr(d.outstanding) : "—"}
          hint={d ? `${d.pending} awaiting approval · ${d.exceptions} exceptions` : undefined}
          className="hover:border-primary/40 hover:shadow-md"
        />
      </Link>
      <Link to="/finance/payables">
        <Stat
          label="Overdue bills"
          value={d ? inr(d.overdue) : "—"}
          hint={d ? `${d.overdueN} bills` : undefined}
          className="hover:border-primary/40 hover:shadow-md"
        />
      </Link>
      <Link to="/finance/payments">
        <Stat
          label="Payments this month"
          value={d ? inr(d.paid) : "—"}
          hint="Recorded payments"
          className="hover:border-primary/40 hover:shadow-md"
        />
      </Link>
    </>
  );
}

function InvCards() {
  const q = useQuery({
    queryKey: ["stock", "summary"],
    queryFn: async () => {
      const [s, t] = await Promise.all([
        loadCompleteRows(async (start, end) => {
          const result = await supabase
            .from("warehouse_stock")
            .select(
              "warehouse_id,material_id,quantity_on_hand,total_value,items(minimum_stock,reorder_level,maximum_stock)",
              { count: "exact" },
            )
            .order("warehouse_id")
            .order("material_id")
            .range(start, end);
          return {
            ...result,
            data:
              result.data?.map((row) => ({
                ...row,
                id: `${row.warehouse_id}/${row.material_id}`,
              })) ?? null,
          };
        }),
        supabase
          .from("stock_transfers")
          .select("id", { count: "exact", head: true })
          .gte("transfer_date", new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)),
      ]);
      if (t.error) throw t.error;
      if (t.count === null) throw new Error("Transfer count could not be verified.");
      const rows = s;
      const stock = summarizeDashboardStock(rows);
      return {
        value: rows.reduce((a, x) => a + Number(x.total_value), 0),
        low: stock.low.filter((x) => Number(x.quantity_on_hand) > 0).length,
        unvalued: stock.unvalued,
        out: rows.filter((x) => Number(x.quantity_on_hand) <= 0).length,
        transfers: t.count ?? 0,
      };
    },
  });
  if (q.isError)
    return (
      <div
        role="alert"
        className="mt-4 rounded-xl border border-destructive/30 p-4 text-sm text-destructive"
      >
        This summary is unavailable.{" "}
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          Retry
        </Button>
      </div>
    );
  const d = q.data;
  return (
    <>
      <Link to="/inventory/stock">
        <Stat
          label="Inventory value"
          value={d ? inr(d.value) : "—"}
          hint={
            d?.unvalued
              ? `${d.unvalued} stock lines have no recorded value`
              : "Weighted average cost"
          }
          className="hover:border-primary/40 hover:shadow-md"
        />
      </Link>
      <Link to="/inventory/stock">
        <Stat
          label="Low / out of stock"
          value={d ? `${d.low} / ${d.out}` : "—"}
          hint={d ? `${d.transfers} transfers in last 30 days` : undefined}
          className="hover:border-primary/40 hover:shadow-md"
        />
      </Link>
    </>
  );
}

function Panel({
  title,
  to,
  children,
  className,
}: {
  title: string;
  to?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={"rounded-xl border bg-card shadow-card " + (className ?? "")}>
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {to && (
          <Link to={to} className="text-sm text-primary hover:underline">
            View all
          </Link>
        )}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
  to,
}: {
  label: string;
  value: React.ReactNode;
  icon: typeof Building2;
  tone: string;
  to?: string;
}) {
  const body = (
    <div className="flex h-full items-start justify-between gap-3 rounded-xl border bg-card p-4 shadow-card transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md md:p-5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
        <div className="num mt-2 truncate text-xl font-semibold text-foreground 2xl:text-2xl">
          {value}
        </div>
      </div>
      <span aria-hidden className={"grid h-9 w-9 shrink-0 place-items-center rounded-lg " + tone}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-xl">
      {body}
    </Link>
  ) : (
    body
  );
}

const STATUS_TONE: Record<string, string> = {
  under_construction: "bg-st-available/12 text-st-available border-st-available/30",
  near_completion: "bg-st-available/12 text-st-available border-st-available/30",
  completed: "bg-st-booked/12 text-st-booked border-st-booked/30",
  planning: "bg-muted text-muted-foreground border-border",
  approval: "bg-st-hold/15 text-st-hold border-st-hold/40",
  on_hold: "bg-st-hold/15 text-st-hold border-st-hold/40",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
};

function Overview({
  canMoney,
  canStock,
  canPr,
  canPo,
  canAp,
  canTeam,
  projectId,
  buildingId,
}: {
  canMoney: boolean;
  canStock: boolean;
  canPr: boolean;
  canPo: boolean;
  canAp: boolean;
  canTeam: boolean;
  projectId: string;
  buildingId: string;
}) {
  const q = useQuery({
    queryKey: ["dashboard", "overview", projectId, buildingId],
    queryFn: async () => {
      let unitsQuery = supabase.from("units").select("id,status", { count: "exact" }).order("id");
      let prQuery = supabase
        .from("purchase_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending_approval");
      let poQuery = supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .in("status", ["approved", "sent", "partially_received", "partially_accepted"]);
      let invoiceQuery = supabase
        .from("vendor_invoices")
        .select("id,balance_due", { count: "exact" })
        .order("id")
        .in("status", ["approved", "partially_paid"]);
      if (projectId) {
        unitsQuery = unitsQuery.eq("project_id", projectId);
        prQuery = prQuery.eq("project_id", projectId);
        poQuery = poQuery.eq("project_id", projectId);
        invoiceQuery = invoiceQuery.eq("project_id", projectId);
      }
      if (buildingId) {
        unitsQuery = unitsQuery.eq("building_id", buildingId);
        prQuery = prQuery.eq("building_id", buildingId);
        poQuery = poQuery.eq("building_id", buildingId);
        invoiceQuery = invoiceQuery.eq("building_id", buildingId);
      }
      const [projects, team, units, stockRows, pr, po, inv] = await Promise.all([
        loadCompleteRows(
          async (start, end) =>
            await supabase
              .from("projects")
              .select("id,name,code,status,budget,city", { count: "exact" })
              .order("created_at", { ascending: false })
              .order("id")
              .range(start, end),
        ),
        canTeam
          ? supabase
              .from("profiles")
              .select("id", { count: "exact", head: true })
              .eq("is_active", true)
          : Promise.resolve({ count: null, error: null }),
        loadCompleteRows(async (start, end) => await unitsQuery.range(start, end)),
        canStock
          ? loadCompleteRows(async (start, end) => {
              let request = supabase
                .from("warehouse_stock")
                .select(
                  "warehouse_id,material_id,quantity_on_hand,total_value,items(name,minimum_stock,reorder_level,maximum_stock),warehouses!inner(project_id)",
                  { count: "exact" },
                )
                .order("warehouse_id")
                .order("material_id");
              if (projectId) request = request.eq("warehouses.project_id", projectId);
              const result = await request.range(start, end);
              return {
                ...result,
                data:
                  result.data?.map((row) => ({
                    ...row,
                    id: `${row.warehouse_id}/${row.material_id}`,
                  })) ?? null,
              };
            })
          : [],
        canPr ? prQuery : Promise.resolve({ count: null, error: null }),
        canPo ? poQuery : Promise.resolve({ count: null, error: null }),
        canAp ? loadCompleteRows(async (start, end) => await invoiceQuery.range(start, end)) : [],
      ]);
      for (const result of [team, pr, po]) if (result.error) throw result.error;
      if (
        (canTeam && team.count === null) ||
        (canPr && pr.count === null) ||
        (canPo && po.count === null)
      )
        throw new Error("Summary counts could not be verified.");
      const stock = summarizeDashboardStock(stockRows);
      const uc: Record<string, number> = {};
      for (const u of units) uc[u.status] = (uc[u.status] ?? 0) + 1;
      return {
        projects: projectId ? projects.filter((p) => p.id === projectId) : projects,
        team: team.count,
        units: uc,
        ...stock,
        pendingPr: pr.count,
        openPo: po.count,
        payable: inv.reduce((sum, row) => sum + Number(row.balance_due), 0),
      };
    },
  });
  if (q.isError)
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive"
      >
        Dashboard totals are unavailable.{" "}
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          Retry
        </Button>
      </div>
    );
  if (q.isLoading) return <Loading />;
  const d = q.data;
  if (!d) return null;
  const active = d.projects.filter((p) =>
    ["under_construction", "near_completion"].includes(p.status),
  ).length;
  const budget = d.projects.reduce((a, p) => a + Number(p.budget ?? 0), 0);
  const groups = [
    { label: "Active", n: active, c: "var(--st-available)" },
    {
      label: "Completed",
      n: d.projects.filter((p) => p.status === "completed").length,
      c: "var(--st-booked)",
    },
    {
      label: "Planning",
      n: d.projects.filter((p) => ["planning", "approval"].includes(p.status)).length,
      c: "var(--st-cancelled)",
    },
    {
      label: "On hold",
      n: d.projects.filter((p) => ["on_hold", "cancelled"].includes(p.status)).length,
      c: "var(--st-hold)",
    },
  ];
  const total = groups.reduce((a, g) => a + g.n, 0) || 1;
  let acc = 0;
  const donut = `conic-gradient(${groups
    .map((g) => {
      const a = acc;
      acc += (g.n / total) * 360;
      return `${g.c} ${a}deg ${acc}deg`;
    })
    .join(",")})`;
  const unitRows = [
    { label: "Available", n: d.units["available"] ?? 0, c: "bg-st-available" },
    { label: "Held", n: d.units["hold"] ?? 0, c: "bg-st-hold" },
    {
      label: "Booked",
      n:
        (d.units["booked"] ?? 0) +
        (d.units["agreement_pending"] ?? 0) +
        (d.units["agreement_done"] ?? 0),
      c: "bg-st-booked",
    },
    {
      label: "Sold / registered",
      n:
        (d.units["registered"] ?? 0) +
        (d.units["possession_pending"] ?? 0) +
        (d.units["possession_completed"] ?? 0),
      c: "bg-st-registered",
    },
    { label: "Withdrawn", n: d.units["cancelled"] ?? 0, c: "bg-st-cancelled" },
  ];
  const uMax = Math.max(1, ...unitRows.map((r) => r.n));
  return (
    <>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4 md:gap-4">
        <Kpi
          label="Total Projects"
          value={d.projects.length}
          icon={Building2}
          tone="bg-accent text-accent-foreground"
          to="/projects"
        />
        <Kpi
          label="Active Projects"
          value={active}
          icon={Clock}
          tone="bg-st-available/12 text-st-available"
          to="/projects"
        />
        <Kpi
          label="Company Team Members"
          value={canTeam ? d.team : "—"}
          icon={Users}
          tone="bg-muted text-foreground"
        />
        <Kpi
          label="Project Budget"
          value={canMoney ? inr(budget) : "—"}
          icon={IndianRupee}
          tone="bg-st-hold/15 text-st-hold"
        />
        <Kpi
          label="PRs Pending Approval"
          value={canPr ? d.pendingPr : "—"}
          icon={ClipboardList}
          tone="bg-accent text-accent-foreground"
          to="/procurement/purchase-requests"
        />
        <Kpi
          label="Open Purchase Orders"
          value={canPo ? d.openPo : "—"}
          icon={ShoppingCart}
          tone="bg-st-available/12 text-st-available"
          to="/procurement/purchase-orders"
        />
        <Kpi
          label="Vendor Payables"
          value={canAp ? inr(d.payable) : "—"}
          icon={Wallet}
          tone="bg-st-hold/15 text-st-hold"
          to="/finance/payables"
        />
        <Kpi
          label={projectId ? "Project Low Stock" : "Low Stock Materials"}
          value={canStock ? d.low.length : "—"}
          icon={AlertTriangle}
          tone="bg-destructive/10 text-destructive"
          to="/inventory/stock"
        />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Panel title="Recent projects" to="/projects" className="lg:col-span-2">
          {d.projects.length === 0 && (
            <div className="text-sm text-muted-foreground">No projects yet.</div>
          )}
          <div className="divide-y">
            {d.projects.slice(0, 5).map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{p.city ?? ""}</div>
                </div>
                <span
                  className={
                    "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium " +
                    (STATUS_TONE[p.status] ?? "")
                  }
                >
                  {PROJECT_STATUS_LABEL[p.status as keyof typeof PROJECT_STATUS_LABEL]}
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Projects by status">
          <div className="flex flex-col items-center gap-5">
            <div
              className="relative h-44 w-44 rounded-full"
              style={{ background: d.projects.length ? donut : "var(--muted)" }}
            >
              <div className="absolute inset-7 rounded-full bg-card" />
            </div>
            <div className="flex flex-wrap justify-center gap-3 text-xs text-muted-foreground">
              {groups.map((g) => (
                <span key={g.label} className="flex items-center gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-sm" style={{ background: g.c }} />
                  {g.label} ({g.n})
                </span>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Unit inventory" to="/units">
          <div className="space-y-3">
            {unitRows.map((r) => (
              <div
                key={r.label}
                className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-sm"
              >
                <span className="text-muted-foreground">{r.label}</span>
                <span className="h-2 rounded-full bg-muted">
                  <i
                    className={"block h-2 rounded-full " + r.c}
                    style={{ width: `${(r.n / uMax) * 100}%` }}
                  />
                </span>
                <span className="text-right font-medium tabular-nums">{r.n}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Low stock materials" to="/inventory/stock" className="lg:col-span-2">
          {!canStock ? (
            <div className="text-sm text-muted-foreground">No stock access.</div>
          ) : d.low.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No low-stock alerts among materials with configured thresholds.
            </div>
          ) : (
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
              {d.low.slice(0, 9).map((x, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{x.items?.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {Number(x.quantity_on_hand)} / {Number(x.items?.reorder_level)}
                    </div>
                  </div>
                  <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                    Low
                  </span>
                </div>
              ))}
            </div>
          )}
          {canStock && d.unconfigured > 0 && (
            <p className="mt-3 text-sm text-warning">
              {d.unconfigured} stock lines have no reorder thresholds. Configure Materials before
              relying on alerts.
            </p>
          )}
          {canStock && d.unvalued > 0 && (
            <p className="mt-3 text-sm text-warning">
              {d.unvalued} positive stock lines have no recorded value. Review opening costs with
              Accounts.
            </p>
          )}
        </Panel>
      </div>
    </>
  );
}

function QuickActions({ can }: { can: (p: string) => boolean }) {
  const actions = [
    can("purchase_request.create") && {
      to: "/procurement/purchase-requests/new",
      label: "New purchase request",
      icon: Plus,
    },
    can("rfq.view") && { to: "/procurement/rfqs", label: "RFQs & quotations", icon: ClipboardList },
    can("purchase_order.view") && {
      to: "/procurement/follow-ups",
      label: "Supplier follow-ups",
      icon: ClipboardList,
    },
    can("purchase_order.view") && {
      to: "/procurement/supplier-rate-history",
      label: "Supplier price history",
      icon: Store,
    },
    can("financial.view") && {
      to: "/reports/project-cost-control",
      label: "Project cost control",
      icon: IndianRupee,
    },
    can("grn.view") && { to: "/inventory/goods-received", label: "Receive goods", icon: Package },
    can("inventory.view") && {
      to: "/inventory/reorder-planning",
      label: "Low stock & reorder",
      icon: AlertTriangle,
    },
    can("vendor_invoice.view") && {
      to: "/finance/vendor-invoices",
      label: "Vendor invoices",
      icon: Wallet,
    },
    { to: "/units", label: "Flats inventory", icon: Building2 },
  ].filter(Boolean) as { to: string; label: string; icon: typeof Plus }[];
  return (
    <nav
      aria-label="Quick actions"
      className="mb-6 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]"
    >
      {actions.map((a) => (
        <Link
          key={a.to}
          to={a.to}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border bg-card px-3.5 text-sm font-medium shadow-card transition-colors hover:border-primary/40 hover:text-primary sm:min-h-9"
        >
          <a.icon className="h-4 w-4 text-primary" aria-hidden />
          {a.label}
        </Link>
      ))}
    </nav>
  );
}

function Dashboard() {
  const can = useCan();
  const current = fyOf(new Date());
  const [fy, setFy] = useState(current);
  const [projectId, setProjectId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  useEffect(() => {
    const saved = window.localStorage.getItem("kk-dashboard-project");
    if (saved) setProjectId(saved);
  }, []);
  function selectProject(id: string) {
    setProjectId(id);
    setBuildingId("");
    if (id) window.localStorage.setItem("kk-dashboard-project", id);
    else window.localStorage.removeItem("kk-dashboard-project");
  }

  const q = useQuery({
    queryKey: ["dashboard", projectId, buildingId],
    queryFn: async () => {
      const pq = supabase
        .from("projects")
        .select("id,name,code,status,budget,estimated_cost")
        .order("name");
      let bq = supabase.from("buildings").select("id,name,project_id,budget");
      if (projectId) bq = bq.eq("project_id", projectId);
      const [p, b, v, i, w, categories, a] = await Promise.all([
        pq,
        bq,
        supabase
          .from("vendors")
          .select("id", { count: "exact", head: true })
          .eq("status", "active"),
        supabase.from("items").select("id", { count: "exact", head: true }).eq("status", "active"),
        projectId
          ? supabase
              .from("warehouses")
              .select("id", { count: "exact", head: true })
              .eq("status", "active")
              .eq("project_id", projectId)
          : supabase
              .from("warehouses")
              .select("id", { count: "exact", head: true })
              .eq("status", "active"),
        supabase
          .from("item_categories")
          .select("id", { count: "exact", head: true })
          .eq("status", "active"),
        supabase
          .from("audit_logs")
          .select("id,action,entity,entity_id,created_at")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      for (const r of [p, b, v, i, w, categories, a]) if (r.error) throw r.error;
      return {
        projects: p.data ?? [],
        buildings: b.data ?? [],
        vendors: v.count ?? 0,
        materials: i.count ?? 0,
        categories: categories.count ?? 0,
        warehouses: w.count ?? 0,
        audit: a.data ?? [],
      };
    },
  });

  // A clean-slate data reset can leave a previously selected project ID in
  // localStorage. Clear it rather than filtering an empty dashboard forever.
  useEffect(() => {
    if (!q.data) return;
    if (projectId && !q.data.projects.some((project) => project.id === projectId)) {
      setProjectId("");
      setBuildingId("");
      window.localStorage.removeItem("kk-dashboard-project");
    } else if (buildingId && !q.data.buildings.some((building) => building.id === buildingId)) {
      setBuildingId("");
    }
  }, [q.data, projectId, buildingId]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="text-sm text-destructive">{q.error.message}</div>;
  const d = q.data!;
  const scoped = projectId ? d.projects.filter((p) => p.id === projectId) : d.projects;
  const selectedProject = d.projects.find((p) => p.id === projectId);
  const scopedBuildings = projectId
    ? d.buildings.filter((b) => b.project_id === projectId)
    : d.buildings;
  const active = scoped.filter((p) =>
    ["under_construction", "near_completion"].includes(p.status),
  ).length;
  const building = scopedBuildings.find((b) => b.id === buildingId);
  const budget = building
    ? Number(building.budget)
    : scoped.reduce((s, p) => s + Number(p.budget), 0);

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-brass">
            Command centre · {fyLabel(fy)}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight md:text-[22px]">
            {selectedProject?.name ?? "All projects"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedProject
              ? `${selectedProject.code} · ${scopedBuildings.length} building${scopedBuildings.length === 1 ? "" : "s"}`
              : `${d.projects.length} projects across KK GROUP`}{" "}
            · 1 Apr {fy} – 31 Mar {fy + 1}
            {selectedProject && (
              <>
                {" "}
                ·{" "}
                <Link to="/projects" className="font-medium text-primary hover:underline">
                  View projects
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex lg:items-center">
          <label className="sr-only" htmlFor="dash-fy">
            Financial year
          </label>
          <select
            id="dash-fy"
            className="min-h-11 sm:min-h-9 lg:w-36"
            value={fy}
            onChange={(e) => setFy(Number(e.target.value))}
          >
            {[current + 1, current, current - 1, current - 2].map((y) => (
              <option key={y} value={y}>
                {fyLabel(y)}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="dash-project">
            Project
          </label>
          <select
            id="dash-project"
            className="min-h-11 sm:min-h-9 lg:w-52"
            value={projectId}
            onChange={(e) => selectProject(e.target.value)}
          >
            <option value="">All projects</option>
            {d.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="dash-building">
            Building
          </label>
          <select
            id="dash-building"
            className="min-h-11 sm:min-h-9 lg:w-44"
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value)}
            disabled={!projectId}
          >
            <option value="">All buildings</option>
            {scopedBuildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <FirstRunSetup
        counts={{
          projects: d.projects.length,
          categories: d.categories,
          materials: d.materials,
          vendors: d.vendors,
          warehouses: d.warehouses,
        }}
        can={can}
      />
      <QuickActions can={can} />
      <Overview
        canTeam={can("users.manage") || can("projects.manage")}
        canMoney={can("financial.view")}
        canStock={can("inventory.view")}
        canPr={can("purchase_request.view")}
        canPo={can("purchase_order.view")}
        canAp={can("payable.view")}
        projectId={projectId}
        buildingId={buildingId}
      />
      {(can("purchase_request.view") || can("purchase_order.view") || can("grn.view")) && (
        <div className="mt-10 flex items-center gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Procurement pipeline
          </h2>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      {can("purchase_request.view") && (
        <DeferredDashboardSection label="Purchase request summary">
          <PrSummary
            fy={fy}
            projectId={projectId}
            buildingId={buildingId}
            canCreate={can("purchase_request.create")}
          />
        </DeferredDashboardSection>
      )}
      {can("purchase_order.view") && (
        <DeferredDashboardSection label="Purchase order summary">
          <PoSummary fy={fy} projectId={projectId} buildingId={buildingId} />
        </DeferredDashboardSection>
      )}
      {can("grn.view") && (
        <DeferredDashboardSection label="Goods receipt summary">
          <GrnSummary fy={fy} projectId={projectId} buildingId={buildingId} />
        </DeferredDashboardSection>
      )}
      <div className="mt-10 flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Stores, vendors & projects
        </h2>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid gap-x-6 xl:grid-cols-2">
        <DeferredDashboardSection label="Inventory overview" minHeight={340}>
          <Section title="Inventory">
            <Link to="/materials">
              <Stat
                label="Total materials"
                value={
                  <span className="flex items-center justify-between">
                    {d.materials}
                    <Package className="h-5 w-5 text-primary" />
                  </span>
                }
                hint="Active material master"
                className="hover:border-primary/40 hover:shadow-md"
              />
            </Link>
            <Link to="/warehouses">
              <Stat
                label="Stores"
                value={
                  <span className="flex items-center justify-between">
                    {d.warehouses}
                    <Warehouse className="h-5 w-5 text-primary" />
                  </span>
                }
                hint={projectId ? "For selected project" : "All active stores"}
                className="hover:border-primary/40 hover:shadow-md"
              />
            </Link>
            {can("inventory.view") ? (
              <InvCards />
            ) : (
              <>
                <Pending label="Inventory value" phase={4} />
                <Pending label="Low / out of stock" phase={4} />
              </>
            )}
          </Section>
        </DeferredDashboardSection>
        <DeferredDashboardSection label="Vendor and payables overview" minHeight={340}>
          <Section title="Vendors">
            <Link to="/vendors">
              <Stat
                label="Active vendors"
                value={
                  <span className="flex items-center justify-between">
                    {d.vendors}
                    <Store className="h-5 w-5 text-primary" />
                  </span>
                }
                hint="Supplier master"
                className="hover:border-primary/40 hover:shadow-md"
              />
            </Link>
            {can("payable.view") ? (
              <ApCards />
            ) : (
              <>
                <Pending label="Vendor payables" phase={5} />
                <Pending label="Overdue bills" phase={5} />
                <Pending label="Payments this month" phase={5} />
              </>
            )}
          </Section>
        </DeferredDashboardSection>
        <Section title="Projects">
          <Link to="/projects">
            <Stat
              label="Active projects"
              value={
                <span className="flex items-center justify-between">
                  {active}
                  <Building2 className="h-5 w-5 text-primary" />
                </span>
              }
              hint={`${scoped.length} total`}
              className="hover:border-primary/40 hover:shadow-md"
            />
          </Link>
          <Stat
            label="Buildings"
            value={building ? 1 : d.buildings.length}
            hint={projectId ? "In selected project" : "All projects"}
          />
          {can("financial.view") ? (
            <Stat
              label="Budget"
              value={inr(budget)}
              hint={building ? building.name : "Sum of project budgets"}
            />
          ) : (
            <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
              Budget hidden — no financial access
            </div>
          )}
          <div className="rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground">
            {can("financial.view") ? (
              <Link to="/reports/project-cost-control" className="text-primary hover:underline">
                View project cost control
              </Link>
            ) : (
              "Project costs require financial access."
            )}
          </div>
        </Section>
      </div>
      <section className="mt-8">
        <h2 className="mb-3 flex items-baseline gap-2 text-[15px] font-semibold tracking-tight">
          Recent activity
        </h2>
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          {d.audit.length === 0 && (
            <div className="p-4 text-xs text-muted-foreground">No recorded activity yet.</div>
          )}
          {d.audit.map((x) => (
            <div
              key={x.id}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b px-4 py-3 text-xs sm:grid-cols-[11rem_12rem_minmax(0,1fr)] last:border-0"
            >
              <span className="text-muted-foreground">{fmtDateTime(x.created_at)}</span>
              <span className="min-w-0 break-words font-medium capitalize">
                {x.action.replaceAll("_", " ")}
              </span>
              <span className="col-span-2 min-w-0 truncate sm:col-span-1">
                {x.entity.replaceAll("_", " ")}{" "}
                <span className="font-mono text-muted-foreground">{x.entity_id}</span>
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
