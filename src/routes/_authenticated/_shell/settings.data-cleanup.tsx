import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowUpRight, ShieldCheck, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PermanentDelete } from "@/components/erp/permanent-delete";
import { Loading, PageHeader, SearchBox } from "@/components/erp/common";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useMe } from "@/lib/session";
import { safeSearch } from "@/lib/utils";
import { errMsg } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/_shell/settings/data-cleanup")({
  head: () => ({ meta: [{ title: "Data cleanup — KK GROUP ERP" }] }),
  component: DataCleanup,
});

const sources = {
  material: {
    title: "Materials",
    table: "items",
    label: "name",
    columns: "id,label:name,detail:code,status",
    page: "/materials",
  },
  vendor: {
    title: "Vendors",
    table: "vendors",
    label: "company_name",
    columns: "id,label:company_name,detail:code,status",
    page: "/vendors",
  },
  project: {
    title: "Projects",
    table: "projects",
    label: "name",
    columns: "id,label:name,detail:code,status",
    page: "/projects",
  },
  building: {
    title: "Buildings",
    table: "buildings",
    label: "name",
    columns: "id,label:name,detail:code,status,projects(name)",
    page: "/buildings",
  },
  floor: {
    title: "Building floors",
    table: "floors",
    label: "name",
    columns: "id,label:name,buildings(name,projects(name))",
    page: "/buildings",
  },
  unit: {
    title: "Available property units",
    table: "units",
    label: "unit_number",
    columns: "id,label:unit_number,status,buildings(name),projects(name)",
    page: "/units",
  },
  warehouse: {
    title: "Warehouses & stores",
    table: "warehouses",
    label: "name",
    columns: "id,label:name,detail:code,status",
    page: "/warehouses",
  },
  purchase_request: {
    title: "Draft purchase requests",
    table: "purchase_requests",
    label: "pr_number",
    columns: "id,label:pr_number,detail:purpose,status",
    page: "/procurement/purchase-requests",
  },
  rfq: {
    title: "Draft RFQs",
    table: "rfqs",
    label: "rfq_number",
    columns: "id,label:rfq_number,status",
    page: "/procurement/rfqs",
  },
  goods_receipt: {
    title: "Draft goods receipts",
    table: "goods_receipt_notes",
    label: "grn_number",
    columns: "id,label:grn_number,status",
    page: "/inventory/goods-received",
  },
} as const;
type Kind = keyof typeof sources;
type CleanupRow = {
  id: string;
  label: string;
  detail?: string | number | null;
  status?: string;
  projects?: { name: string } | null;
  buildings?: { name: string; projects?: { name: string } | null } | null;
};

const corrections = [
  {
    title: "Purchase orders",
    to: "/procurement/purchase-orders",
    description:
      "Open the wrong order and cancel it before goods are received. Its quotation and approval history remain traceable.",
  },
  {
    title: "Goods receipts & stock",
    to: "/inventory/goods-received",
    description:
      "Cancel an incorrect receipt to reverse its stock movement. Dependent invoices and consumed stock must be resolved first.",
  },
  {
    title: "Vendor invoices",
    to: "/finance/vendor-invoices",
    description:
      "Cancel an unapproved invoice. Approved bills and posted journals retain their accounting history.",
  },
  {
    title: "Vendor payments",
    to: "/finance/payments",
    description:
      "Cancel a scheduled or approved payment before recording it. Recorded money movements cannot be erased.",
  },
  {
    title: "Small expenses",
    to: "/finance/small-expenses",
    description:
      "Void a wrong entry with a reason to remove it from active expense totals and keep the original history.",
  },
  {
    title: "Material issues & returns",
    to: "/inventory/material-issues",
    description:
      "Open the issue and record a material return when goods come back. Stock movements remain in the ledger.",
  },
  {
    title: "RFQs & quotations",
    to: "/procurement/rfqs",
    description:
      "Review or cancel the RFQ where allowed. Vendor responses and awards linked to orders are protected.",
  },
  {
    title: "Delivery challans",
    to: "/inventory/delivery-challans",
    description:
      "Review and cancel an unused challan from its main page. Receipts already recorded against it remain protected.",
  },
] as const;

function DataCleanup() {
  const me = useMe();
  const [kind, setKind] = useState<Kind>("purchase_request");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const allowed = !!me.data?.profile.is_active && me.data.roles.includes("super_admin");
  const company = me.data?.profile.company_id;
  const source = sources[kind];
  const q = useQuery({
    queryKey: ["data-cleanup", company, kind, search, page],
    enabled: allowed && !!company,
    queryFn: async () => {
      let request = supabase.from(source.table).select(source.columns, { count: "exact" });
      if (["building", "floor", "unit"].includes(kind)) {
        const projects = await supabase.from("projects").select("id").eq("company_id", company!);
        if (projects.error) throw projects.error;
        if (!projects.data.length) return { rows: [] as CleanupRow[], count: 0 };
        if (kind === "floor") {
          const buildings = await supabase
            .from("buildings")
            .select("id")
            .in(
              "project_id",
              projects.data.map((p) => p.id),
            );
          if (buildings.error) throw buildings.error;
          if (!buildings.data.length) return { rows: [] as CleanupRow[], count: 0 };
          request = request.in(
            "building_id",
            buildings.data.map((b) => b.id),
          );
        } else
          request = request.in(
            "project_id",
            projects.data.map((p) => p.id),
          );
      } else request = request.filter("company_id", "eq", company!);
      if (["purchase_request", "rfq", "goods_receipt"].includes(kind))
        request = request.filter("status", "eq", "draft");
      if (kind === "unit") request = request.filter("status", "eq", "available");
      const term = safeSearch(search);
      if (term) request = request.ilike(source.label, `%${term}%`);
      const result = await request
        .order(source.label)
        .order("id")
        .range(page * 20, page * 20 + 19);
      if (result.error) throw result.error;
      return { rows: result.data as unknown as CleanupRow[], count: result.count ?? 0 };
    },
  });
  if (me.isLoading) return <Loading />;
  if (!allowed || !company)
    return <p role="alert">Only an active company Super Admin can use data cleanup.</p>;
  return (
    <>
      <PageHeader
        title="Data cleanup"
        subtitle="Remove incorrect unused records, or open the original document to make a traceable correction."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/audit">View audit log</Link>
          </Button>
        }
      />
      <div className="mb-6 flex gap-3 rounded-xl border bg-card p-4 text-sm">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <p>
          <strong>Super Admin only.</strong> Each deletion checks your company and linked records
          again. Stock, payments, approvals and audit history cannot be erased. Nothing is deleted
          until you confirm a specific record.
        </p>
      </div>
      <section aria-labelledby="unused-heading" className="rounded-xl border bg-card p-4 sm:p-6">
        <h2 id="unused-heading" className="flex items-center gap-2 text-lg font-semibold">
          <Trash2 className="h-5 w-5" />
          Delete unused records
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Linked records are checked before confirmation. For a building, remove its unused units
          and floors first.
        </p>
        <div className="my-5 grid items-end gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cleanup-kind">Record type</Label>
            <select
              id="cleanup-kind"
              className="h-11 w-full rounded-lg border bg-background px-3 text-sm"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Kind);
                setSearch("");
                setPage(0);
              }}
            >
              {Object.entries(sources).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.title}
                </option>
              ))}
            </select>
          </div>
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(0);
            }}
            placeholder={`Search ${source.title.toLowerCase()}`}
          />
        </div>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <p role="alert" className="text-sm text-destructive">
            {errMsg(q.error)}
          </p>
        ) : (
          <>
            <div className="divide-y rounded-lg border">
              {q.data?.rows.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 p-3 sm:p-4">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">{row.label}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {[
                        row.detail,
                        row.buildings?.name,
                        row.projects?.name ?? row.buildings?.projects?.name,
                        row.status,
                      ]
                        .filter((value) => value != null && value !== "")
                        .join(" · ")}
                    </p>
                  </div>
                  <PermanentDelete kind={kind} id={row.id} name={row.label} labelled />
                </div>
              ))}
              {!q.data?.rows.length && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No matching records. Submitted documents are corrected from their main page.
                </p>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                {q.data?.count ?? 0} records · Page {page + 1}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(page + 1) * 20 >= (q.data?.count ?? 0)}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild variant="link" className="px-0">
            <Link to={source.page}>
              Open {source.title.toLowerCase()}
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="link" className="px-0">
            <Link to="/settings/users">
              Manage staff deletion
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>
      <section aria-labelledby="corrections-heading" className="mt-8">
        <h2 id="corrections-heading" className="text-lg font-semibold">
          Correct records with history
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use cancellation, a void or a return so balances and source documents remain consistent.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {corrections.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="group rounded-xl border bg-card p-4 transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <div className="flex items-center justify-between gap-3 font-medium">
                {item.title}
                <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
