import { RegisterFilters } from "@/components/erp/register-filters";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Loading, PageHeader, SearchBox } from "@/components/erp/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCan } from "@/lib/session";
import { useSiteEngineerReceivingScope } from "@/lib/site-engineer-receiving-scope";
import { Pager } from "@/components/erp/pager";
import { errMsg, fmtDate, inr, num } from "@/lib/format";
import { GRN_STATUS, selectCls } from "@/lib/po";
import { fyLabel, fyOf, fyOptions, PAGE } from "@/lib/fy";
import { cn } from "@/lib/utils";
import { loadCompleteRows } from "@/lib/complete-register";
import { prepareRecordSearch, matchesRecordSearch, visibleSearchPage } from "@/lib/erp-search";
import { CancelDraftGrnButton } from "@/components/erp/cancel-draft-grn";
import { DeleteUnusedGrnButton } from "@/components/erp/delete-unused-grn";

const META = "Register of goods received against purchase orders.";
export const Route = createFileRoute("/_authenticated/_shell/inventory/goods-received/")({
  head: () => ({
    meta: [
      { title: "Goods Received — KK GROUP ERP" },
      { name: "description", content: META },
      { property: "og:title", content: "Goods Received — KK GROUP ERP" },
      { property: "og:description", content: META },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GrnList,
});

function GrnList() {
  const can = useCan();
  const scope = useSiteEngineerReceivingScope();
  const navigate = useNavigate();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [poSearch, setPoSearch] = useState("");
  const [search, setSearch] = useState("");
  const [f, setF] = useState({
    project: "",
    building: "",
    wh: "",
    vendor: "",
    fy: "",
    from: "",
    to: "",
  });
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ["grns"],
    queryFn: async () => {
      return loadCompleteRows(async (start, end) =>
        await supabase
          .from("goods_receipt_notes")
          .select(
            "id,grn_number,received_date,status,posted_at,received_by,po_id,project_id,building_id,warehouse_id,vendor_id,purchase_orders(po_number),vendors(company_name),warehouses(name),projects(name),buildings(name),profiles!goods_receipt_notes_received_by_fkey(full_name),goods_receipt_items(accepted_quantity,unit_cost)",
            { count: "exact" },
          )
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(start, end),
      );
    },
  });
  const receivablePos = useQuery({
    queryKey: ["grn-receivable-purchase-orders", scope.isScopedEngineer, scope.assignedProjectIds],
    enabled: receiveOpen && can("grn.create") && !scope.isLoading && !scope.error,
    queryFn: async () => {
      // Receive a colleague's PO for the same assigned project, never a PO
      // from another project. Database RLS and create_goods_receipt enforce
      // this independently of the displayed choices.
      if (scope.isScopedEngineer && !scope.assignedProjectIds.length) return [];
      return loadCompleteRows(async (start,end)=>{
        let query = supabase.from("purchase_orders")
          .select("id,po_number,status,project_id,vendors(company_name),projects(name),buildings(name)",{count:"exact"})
          .in("status", ["approved", "sent", "partially_received", "partially_accepted"]);
        if (scope.isScopedEngineer) query = query.in("project_id", scope.assignedProjectIds);
        return await query.order("created_at", { ascending: false }).order("id").range(start,end);
      });
    },
  });
  const preparedPoSearch = prepareRecordSearch(poSearch);
  const preparedSearch = prepareRecordSearch(search);
  const matchingPos = (receivablePos.data ?? []).filter((po) =>
    scope.canAccess(po.project_id) &&
    matchesRecordSearch([po.po_number, po.vendors?.company_name, po.projects?.name, po.buildings?.name], preparedPoSearch),
  );
  const all = q.data ?? [];
  const set = (k: keyof typeof f, v: string) => {
    setF({ ...f, [k]: v, ...(k === "project" ? { building: "" } : {}) });
    setPage(0);
  };
  const uniq = <T,>(arr: T[], key: (x: T) => string | null) => [
    ...new Map(arr.filter((x) => key(x)).map((x) => [key(x)!, x])).values(),
  ];
  const rows = all.filter(
    (x) =>
      (!f.project || x.project_id === f.project) &&
      (!f.building || x.building_id === f.building) &&
      (!f.wh || x.warehouse_id === f.wh) &&
      (!f.vendor || x.vendor_id === f.vendor) &&
      (!f.fy || fyOf(x.received_date) === Number(f.fy)) &&
      (!f.from || x.received_date >= f.from) &&
      (!f.to || x.received_date <= f.to) &&
      matchesRecordSearch([
        x.grn_number, x.purchase_orders?.po_number, x.vendors?.company_name,
        x.projects?.name, x.buildings?.name, x.warehouses?.name,
        x.profiles?.full_name,
      ], preparedSearch),
  );
  const visiblePage = visibleSearchPage(page, rows.length, PAGE);
  const pageRows = rows.slice(visiblePage * PAGE, (visiblePage + 1) * PAGE);
  return (
    <>
      <PageHeader
        title="Goods Received"
        subtitle="Receipts are recorded from a purchase order using “Receive goods”."
        actions={can("grn.create") ? <Button size="sm" onClick={() => setReceiveOpen(true)}>Receive goods</Button> : undefined}
      />
      <RegisterFilters activeCount={Object.values(f).filter(Boolean).length}>
        <div className="w-full sm:w-60">
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(0);
            }}
            placeholder="GRN, PO, vendor, project or store"
          />
        </div>
        <select
          aria-label="Filter: projects"
          className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-44 sm:flex-none")}
          value={f.project}
          onChange={(e) => set("project", e.target.value)}
        >
          <option value="">All projects</option>
          {uniq(all, (x) => x.project_id).map((x) => (
            <option key={x.project_id} value={x.project_id}>
              {x.projects?.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter: buildings"
          className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-40 sm:flex-none")}
          value={f.building}
          onChange={(e) => set("building", e.target.value)}
        >
          <option value="">All buildings</option>
          {uniq(
            all.filter((x) => !f.project || x.project_id === f.project),
            (x) => x.building_id,
          ).map((x) => (
            <option key={x.building_id!} value={x.building_id!}>
              {x.buildings?.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter: stores"
          className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-40 sm:flex-none")}
          value={f.wh}
          onChange={(e) => set("wh", e.target.value)}
        >
          <option value="">All stores</option>
          {uniq(all, (x) => x.warehouse_id).map((x) => (
            <option key={x.warehouse_id} value={x.warehouse_id}>
              {x.warehouses?.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter: vendors"
          className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-44 sm:flex-none")}
          value={f.vendor}
          onChange={(e) => set("vendor", e.target.value)}
        >
          <option value="">All vendors</option>
          {uniq(all, (x) => x.vendor_id).map((x) => (
            <option key={x.vendor_id} value={x.vendor_id}>
              {x.vendors?.company_name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter: years"
          className={cn(selectCls, "h-11 min-w-0 flex-1 sm:h-9 sm:w-36 sm:flex-none")}
          value={f.fy}
          onChange={(e) => set("fy", e.target.value)}
        >
          <option value="">All years</option>
          {fyOptions(all.map((x) => x.received_date)).map((y) => (
            <option key={y} value={y}>
              {fyLabel(y)}
            </option>
          ))}
        </select>
        <Input
          type="date"
          className="h-11 min-w-0 flex-1 sm:h-9 sm:w-40 sm:flex-none"
          value={f.from}
          onChange={(e) => set("from", e.target.value)}
          aria-label="From date"
        />
        <Input
          type="date"
          className="h-11 min-w-0 flex-1 sm:h-9 sm:w-40 sm:flex-none"
          value={f.to}
          onChange={(e) => set("to", e.target.value)}
          aria-label="To date"
        />
      </RegisterFilters>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <div className="text-sm text-destructive">{errMsg(q.error)}</div>
      ) : (
        <>
          <div className="doc-table overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">GRN</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">PO</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3">Building</th>
                  <th className="px-4 py-3">Store</th>
                  <th className="px-4 py-3 text-right">Accepted qty</th>
                  <th className="px-4 py-3 text-right">Accepted value</th>
                  <th className="px-4 py-3">By</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="p-4 text-xs text-muted-foreground">
                      No goods received match.
                    </td>
                  </tr>
                )}
                {pageRows.map((x) => {
                  const qty = x.goods_receipt_items.reduce(
                    (a, i) => a + Number(i.accepted_quantity),
                    0,
                  );
                  const value = x.goods_receipt_items.reduce(
                    (a, i) => a + Number(i.accepted_quantity) * Number(i.unit_cost),
                    0,
                  );
                  return (
                    <tr key={x.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium tabular-nums">
                        <Link
                          className="text-primary hover:underline"
                          to="/inventory/goods-received/$id"
                          params={{ id: x.id }}
                        >
                          {x.grn_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{fmtDate(x.received_date)}</td>
                      <td className="px-4 py-3 font-medium tabular-nums text-xs">
                        <Link
                          className="hover:underline"
                          to="/procurement/purchase-orders/$id"
                          params={{ id: x.po_id }}
                        >
                          {x.purchase_orders?.po_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{x.vendors?.company_name}</td>
                      <td className="px-4 py-3">{x.projects?.name}</td>
                      <td className="px-4 py-3">{x.buildings?.name ?? "—"}</td>
                      <td className="px-4 py-3">{x.warehouses?.name}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{num(qty)}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {inr(value)}
                      </td>
                      <td className="px-4 py-3 text-xs">{x.profiles?.full_name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
                            GRN_STATUS[x.status].cls,
                          )}
                        >
                          {GRN_STATUS[x.status].label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <CancelDraftGrnButton id={x.id} number={x.grn_number} status={x.status} receivedBy={x.received_by}/>
                          <DeleteUnusedGrnButton id={x.id} number={x.grn_number} status={x.status} postedAt={x.posted_at}/>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={visiblePage} total={rows.length} size={PAGE} onPage={setPage} />
        </>
      )}
      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose a purchase order to receive</DialogTitle>
            <DialogDescription>
              Select an approved PO for a project assigned to you. Another Site Engineer may
              have raised the original request. A registered supplier challan is required
              before saving the goods receipt.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Search purchase orders to receive"
            placeholder="Search PO, vendor, project or building"
            value={poSearch}
            onChange={(event) => setPoSearch(event.target.value)}
          />
          {scope.error && (
            <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">
              Could not verify your assigned projects: {errMsg(scope.error)}
            </p>
          )}
          {scope.isScopedEngineer && !scope.isLoading && !scope.error && !scope.assignedProjectIds.length && (
            <p role="alert" className="rounded-md border p-3 text-sm text-muted-foreground">
              No project assigned. Ask your administrator to assign your site before recording received goods.
            </p>
          )}
          <div className="max-h-64 space-y-1 overflow-y-auto" aria-label="Receivable purchase orders">
            {scope.isLoading || receivablePos.isLoading ? <Loading /> :
              receivablePos.error ? <p className="p-3 text-sm text-destructive">{errMsg(receivablePos.error)}</p> :
              matchingPos.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No approved purchase orders found.</p> :
              matchingPos.slice(0, 50).map((po) => (
                <Button key={po.id} variant="ghost" className="h-auto w-full justify-start px-3 py-2 text-left"
                  onClick={() => {
                    setReceiveOpen(false);
                    void navigate({ to: "/procurement/purchase-orders/$id", params: { id: po.id } });
                  }}>
                  <span className="min-w-0">
                    <span className="block font-semibold">{po.po_number}</span>
                    <span className="block whitespace-normal text-xs text-muted-foreground">
                      {po.vendors?.company_name} · {po.projects?.name}
                      {po.buildings?.name ? ` · ${po.buildings.name}` : ""}
                    </span>
                  </span>
                </Button>
              ))}
          </div>
          <p className="text-xs text-muted-foreground">
            On the PO page, tap "Receive goods" to inspect and record quantities.
            Use Challan Entry first if the supplier challan is not registered.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
