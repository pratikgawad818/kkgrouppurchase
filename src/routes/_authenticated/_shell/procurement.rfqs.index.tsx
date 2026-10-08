import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loading, PageHeader } from "@/components/erp/common";
import { errMsg, fmtDate } from "@/lib/format";
import { RFQ_STATUS, type RfqStatus } from "@/lib/rfq";

export const Route = createFileRoute("/_authenticated/_shell/procurement/rfqs/")({
  head: () => ({ meta: [{ title: "RFQs — KK GROUP ERP" }, { name: "description", content: "Requests for quotation sent to vendors." }, { property: "og:title", content: "RFQs — KK GROUP ERP" }, { property: "og:description", content: "Requests for quotation sent to vendors." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: RfqList,
});

const PAGE = 25;

function RfqList() {
  const [status, setStatus] = useState<RfqStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ["rfqs", status, search, page],
    queryFn: async () => {
      let x = supabase.from("rfqs").select("id,rfq_number,rfq_date,response_due_date,status,projects(code,name),buildings(name),purchase_requests(pr_number),rfq_vendors(status)", { count: "exact" })
        .order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (status) x = x.eq("status", status);
      if (search.trim()) x = x.ilike("rfq_number", `%${search.trim()}%`);
      const { data, error, count } = await x;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });
  return (
    <>
      <PageHeader title="RFQs" subtitle="Create RFQs from an approved purchase request." />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="h-11 w-full sm:h-9 sm:w-56" placeholder="Search RFQ number" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value as RfqStatus | ""); setPage(0); }}>
          <option value="">All statuses</option>
          {Object.entries(RFQ_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : (
        <div className="doc-table overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">RFQ</th><th className="px-4 py-3">PR</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Response due</th><th className="px-4 py-3">Responses</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody>
              {q.data!.rows.length === 0 && <tr><td colSpan={7} className="p-4 text-xs text-muted-foreground">No RFQs yet. Open an approved purchase request and choose “Create RFQ”.</td></tr>}
              {q.data!.rows.map((r) => {
                const v = r.rfq_vendors ?? [];
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium tabular-nums"><Link className="text-primary hover:underline" to="/procurement/rfqs/$id" params={{ id: r.id }}>{r.rfq_number}</Link></td>
                    <td className="px-4 py-3 font-medium tabular-nums text-xs">{r.purchase_requests?.pr_number}</td>
                    <td className="px-4 py-3">{r.projects?.code} · {r.projects?.name}{r.buildings ? ` / ${r.buildings.name}` : ""}</td>
                    <td className="px-4 py-3">{fmtDate(r.rfq_date)}</td>
                    <td className="px-4 py-3">{fmtDate(r.response_due_date)}</td>
                    <td className="px-4 py-3">{v.filter((x) => x.status !== "pending").length}/{v.length}</td>
                    <td className="px-4 py-3"><span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium font-medium ${RFQ_STATUS[r.status].cls}`}>{RFQ_STATUS[r.status].label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t p-2 text-xs text-muted-foreground">
            <span>{q.data!.count} RFQs</span>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= q.data!.count} onClick={() => setPage(page + 1)}>Next</Button></div>
          </div>
        </div>
      )}
    </>
  );
}
