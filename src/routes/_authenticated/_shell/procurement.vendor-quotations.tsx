import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loading, PageHeader } from "@/components/erp/common";
import { errMsg, fmtDate, inr } from "@/lib/format";
import { QUOTATION_STATUS } from "@/lib/rfq";

export const Route = createFileRoute("/_authenticated/_shell/procurement/vendor-quotations")({
  head: () => ({ meta: [{ title: "Vendor Quotations — KK GROUP ERP" }, { name: "description", content: "Register of all vendor quotations received." }, { property: "og:title", content: "Vendor Quotations — KK GROUP ERP" }, { property: "og:description", content: "Register of all vendor quotations received." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Register,
});

function Register() {
  const q = useQuery({
    queryKey: ["quotations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendor_quotations").select("id,quotation_number,quotation_date,valid_until,grand_total,status,rfq_id,rfqs(rfq_number),vendors(company_name)").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <>
      <PageHeader title="Vendor Quotations" subtitle="Quotations are recorded from each RFQ." />
      {q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">Quote ref</th><th className="px-4 py-3">RFQ</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Valid until</th><th className="px-4 py-3 text-right">Grand total</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody>
              {q.data!.length === 0 && <tr><td colSpan={7} className="p-4 text-xs text-muted-foreground">No quotations recorded yet.</td></tr>}
              {q.data!.map((x) => <tr key={x.id} className="border-b last:border-0 hover:bg-muted/40"><td className="px-4 py-3">{x.vendors?.company_name}</td><td className="px-4 py-3 font-mono text-xs">{x.quotation_number}</td><td className="px-4 py-3 font-mono"><Link className="text-primary hover:underline" to="/procurement/rfqs/$id" params={{ id: x.rfq_id }}>{x.rfqs?.rfq_number}</Link></td><td className="px-4 py-3">{fmtDate(x.quotation_date)}</td><td className="px-4 py-3">{fmtDate(x.valid_until)}</td><td className="px-4 py-3 text-right font-mono">{inr(x.grand_total)}</td><td className="px-4 py-3">{QUOTATION_STATUS[x.status]}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
