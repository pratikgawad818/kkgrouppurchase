import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loading, PageHeader } from "@/components/erp/common";
import { errMsg, fmtDate } from "@/lib/format";

const META = "Register of goods received against purchase orders.";
export const Route = createFileRoute("/_authenticated/_shell/inventory/goods-received/")({
  head: () => ({ meta: [{ title: "Goods Received — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Goods Received — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: GrnList,
});

function GrnList() {
  const q = useQuery({
    queryKey: ["grns"],
    queryFn: async () => {
      const { data, error } = await supabase.from("goods_receipt_notes").select("id,grn_number,received_date,challan_number,po_id,purchase_orders(po_number),vendors(company_name),warehouses(name),projects(name)").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <>
      <PageHeader title="Goods Received" subtitle="Receipts are recorded from a purchase order using “Receive goods”." />
      {q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="p-2">GRN</th><th className="p-2">PO</th><th className="p-2">Vendor</th><th className="p-2">Store</th><th className="p-2">Project</th><th className="p-2">Challan</th><th className="p-2">Date</th></tr></thead>
            <tbody>
              {q.data!.length === 0 && <tr><td colSpan={7} className="p-4 text-xs text-muted-foreground">No goods received yet.</td></tr>}
              {q.data!.map((x) => (
                <tr key={x.id} className="border-b last:border-0">
                  <td className="p-2 font-mono"><Link className="text-primary hover:underline" to="/inventory/goods-received/$id" params={{ id: x.id }}>{x.grn_number}</Link></td>
                  <td className="p-2 font-mono text-xs"><Link className="hover:underline" to="/procurement/purchase-orders/$id" params={{ id: x.po_id }}>{x.purchase_orders?.po_number}</Link></td>
                  <td className="p-2">{x.vendors?.company_name}</td><td className="p-2">{x.warehouses?.name}</td><td className="p-2">{x.projects?.name}</td>
                  <td className="p-2">{x.challan_number ?? "—"}</td><td className="p-2">{fmtDate(x.received_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
