import { PermanentDelete } from "@/components/erp/permanent-delete";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pager } from "@/components/erp/pager";
import { PAGE } from "@/lib/fy";
import { supabase } from "@/integrations/supabase/client";
import { Loading, PageHeader } from "@/components/erp/common";
import { errMsg, fmtDate, inr } from "@/lib/format";
import { QUOTATION_STATUS } from "@/lib/rfq";

export const Route = createFileRoute("/_authenticated/_shell/procurement/vendor-quotations")({
  head: () => ({ meta: [{ title: "Vendor Quotations — KK GROUP ERP" }, { name: "description", content: "Register of all vendor quotations received." }, { property: "og:title", content: "Vendor Quotations — KK GROUP ERP" }, { property: "og:description", content: "Register of all vendor quotations received." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Register,
});

function Register() {
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ["quotations", page],
    queryFn: async () => {
      const start = page * PAGE;
      const { data, count, error } = await supabase.from("vendor_quotations")
        .select("id,quotation_number,quotation_date,valid_until,grand_total,status,rfq_id,rfqs(rfq_number),vendors(company_name)", { count: "exact" })
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(start, start + PAGE - 1);
      if (error) throw error;
      if (count === null || !Number.isSafeInteger(count) || count < 0 || !data || data.length !== Math.min(PAGE, Math.max(0, count - start))) throw new Error("Could not verify this quotation page. Retry before reviewing.");
      return { rows: data, total: count };
    },
  });
  const lastPage = q.data ? Math.max(0, Math.ceil(q.data.total / PAGE) - 1) : page;
  useEffect(() => { if (page > lastPage) setPage(lastPage); }, [page, lastPage]);
  return (
    <>
      <PageHeader title="Vendor Quotations" subtitle="Quotations are recorded from each RFQ." />
      {q.isLoading || page > lastPage ? <Loading /> : q.error ? <div role="alert" className="text-sm text-destructive">{errMsg(q.error)} <button className="underline" onClick={() => void q.refetch()}>Retry</button></div> : (
        <>
        <div className="doc-table overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">Quote ref</th><th className="px-4 py-3">RFQ</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Valid until</th><th className="px-4 py-3 text-right">Grand total</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
            <tbody>
              {q.data!.rows.length === 0 && <tr><td colSpan={8} className="p-4 text-xs text-muted-foreground">No quotations recorded yet.</td></tr>}
              {q.data!.rows.map((x) => <tr key={x.id} className="border-b last:border-0 hover:bg-muted/40"><td className="px-4 py-3">{x.vendors?.company_name}</td><td className="px-4 py-3 font-medium tabular-nums text-xs">{x.quotation_number}</td><td className="px-4 py-3 font-medium tabular-nums"><Link className="text-primary hover:underline" to="/procurement/rfqs/$id" params={{ id: x.rfq_id }}>{x.rfqs?.rfq_number}</Link></td><td className="px-4 py-3">{fmtDate(x.quotation_date)}</td><td className="px-4 py-3">{fmtDate(x.valid_until)}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{inr(x.grand_total)}</td><td className="px-4 py-3">{QUOTATION_STATUS[x.status]}</td><td className="px-4 py-3 text-right"><PermanentDelete force kind="vendor_quotation" id={x.id} name={x.quotation_number ?? "quotation"}/></td></tr>)}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={q.data!.total} size={PAGE} onPage={setPage} />
        </>
      )}
    </>
  );
}
