import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loading, PageHeader, SearchBox } from "@/components/erp/common";
import { errMsg, fmtDate, inr } from "@/lib/format";
import { PO_STATUS, selectCls, type PoStatus } from "@/lib/po";
import { cn } from "@/lib/utils";

const META = "Purchase orders raised from awarded vendor quotations.";
export const Route = createFileRoute("/_authenticated/_shell/procurement/purchase-orders/")({
  head: () => ({ meta: [{ title: "Purchase Orders — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Purchase Orders — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: PoList,
});

function PoList() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | PoStatus>("");
  const q = useQuery({
    queryKey: ["pos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_orders").select("id,po_number,po_date,expected_delivery_date,grand_total,status,vendors(company_name),projects(name),rfqs(rfq_number)").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  const s = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((x) => (!status || x.status === status) && (!s || [x.po_number, x.vendors?.company_name, x.projects?.name].some((v) => v?.toLowerCase().includes(s))));
  return (
    <>
      <PageHeader title="Purchase Orders" subtitle="Create POs from an RFQ that is Ready for Purchase Order." />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="w-64"><SearchBox value={search} onChange={setSearch} placeholder="PO number, vendor, project" /></div>
        <select className={cn(selectCls, "w-48")} value={status} onChange={(e) => setStatus(e.target.value as PoStatus | "")}>
          <option value="">All statuses</option>
          {Object.entries(PO_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="p-2">PO</th><th className="p-2">Vendor</th><th className="p-2">Project</th><th className="p-2">RFQ</th><th className="p-2">Date</th><th className="p-2">Expected</th><th className="p-2 text-right">Value</th><th className="p-2">Status</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="p-4 text-xs text-muted-foreground">No purchase orders yet.</td></tr>}
              {rows.map((x) => (
                <tr key={x.id} className="border-b last:border-0">
                  <td className="p-2 font-mono"><Link className="text-primary hover:underline" to="/procurement/purchase-orders/$id" params={{ id: x.id }}>{x.po_number}</Link></td>
                  <td className="p-2">{x.vendors?.company_name}</td><td className="p-2">{x.projects?.name}</td><td className="p-2 font-mono text-xs">{x.rfqs?.rfq_number}</td>
                  <td className="p-2">{fmtDate(x.po_date)}</td><td className="p-2">{fmtDate(x.expected_delivery_date)}</td>
                  <td className="p-2 text-right font-mono">{inr(x.grand_total)}</td>
                  <td className="p-2"><span className={cn("rounded-sm border px-1.5 py-0.5 text-[11px]", PO_STATUS[x.status].cls)}>{PO_STATUS[x.status].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
