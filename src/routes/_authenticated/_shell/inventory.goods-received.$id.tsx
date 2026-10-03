import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loading, PageHeader } from "@/components/erp/common";
import { errMsg, fmtDate, inr, num } from "@/lib/format";

const META = "Goods receipt note with accepted and damaged quantities.";
export const Route = createFileRoute("/_authenticated/_shell/inventory/goods-received/$id")({
  head: () => ({ meta: [{ title: "Goods Receipt — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Goods Receipt — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: GrnDetail,
});

function GrnDetail() {
  const { id } = Route.useParams();
  const q = useQuery({
    queryKey: ["grn", id],
    queryFn: async () => {
      const [g, i] = await Promise.all([
        supabase.from("goods_receipt_notes").select("*, purchase_orders(po_number), vendors(company_name), warehouses(name), projects(name), profiles(full_name)").eq("id", id).single(),
        supabase.from("goods_receipt_items").select("*, items(code,name), units_of_measure(code)").eq("grn_id", id),
      ]);
      if (g.error) throw g.error;
      return { g: g.data, items: i.data ?? [] };
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="text-sm text-destructive">{errMsg(q.error)}</div>;
  const { g, items } = q.data!;
  return (
    <>
      <PageHeader crumbs={<Link to="/inventory/goods-received" className="hover:underline">Goods Received</Link>} title={g.grn_number}
        subtitle={<>PO <Link className="font-mono text-primary hover:underline" to="/procurement/purchase-orders/$id" params={{ id: g.po_id }}>{g.purchase_orders?.po_number}</Link> · {g.vendors?.company_name} · {g.warehouses?.name}</>} />
      <section className="grid gap-3 rounded-md border bg-card p-4 text-sm md:grid-cols-4">
        {[["Received date", fmtDate(g.received_date)], ["Received by", g.profiles?.full_name ?? "—"], ["Project", g.projects?.name], ["Challan", g.challan_number ?? "—"], ["Vendor invoice ref.", g.invoice_reference ?? "—"], ["Vehicle", g.vehicle_number ?? "—"], ["Remarks", g.remarks ?? "—"]].map(([l, v]) => (
          <div key={l}><div className="text-[11px] uppercase text-muted-foreground">{l}</div><div className="mt-0.5">{v}</div></div>
        ))}
      </section>
      <section className="mt-4 overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="p-2">Material</th><th className="p-2 text-right">Ordered</th><th className="p-2 text-right">Previously received</th><th className="p-2 text-right">Received</th><th className="p-2 text-right">Damaged</th><th className="p-2 text-right">Accepted to stock</th><th className="p-2 text-right">Unit cost</th></tr></thead>
          <tbody>{items.map((x) => (
            <tr key={x.id} className="border-b last:border-0">
              <td className="p-2">{x.items?.name} <span className="font-mono text-[11px] text-muted-foreground">{x.items?.code}</span></td>
              <td className="p-2 text-right font-mono">{num(x.ordered_quantity)} {x.units_of_measure?.code}</td>
              <td className="p-2 text-right font-mono">{num(x.previously_received)}</td>
              <td className="p-2 text-right font-mono">{num(x.received_quantity)}</td>
              <td className="p-2 text-right font-mono text-destructive">{num(x.damaged_quantity)}</td>
              <td className="p-2 text-right font-mono font-semibold">{num(x.accepted_quantity)}</td>
              <td className="p-2 text-right font-mono">{inr(x.unit_cost)}</td>
            </tr>))}
          </tbody>
        </table>
      </section>
      <p className="mt-2 text-xs text-muted-foreground">Posted receipts are permanent. Corrections will be made through returns or adjustments, never by editing this record.</p>
    </>
  );
}
