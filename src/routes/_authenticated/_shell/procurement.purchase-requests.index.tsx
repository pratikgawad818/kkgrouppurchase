import { safeSearch } from "@/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, Loading, PageHeader, SearchBox } from "@/components/erp/common";
import { errMsg, fmtDate, inr } from "@/lib/format";
import { useCan } from "@/lib/session";
import { PR_PRIORITY, PR_STATUS, type PrPriority, type PrStatus } from "@/lib/pr";

const search = z.object({ status: z.string().optional(), due: z.string().optional() });

export const Route = createFileRoute("/_authenticated/_shell/procurement/purchase-requests/")({
  validateSearch: search,
  head: () => ({ meta: [{ title: "Purchase Requests — KK GROUP ERP" }, { name: "description", content: "Track and approve project purchase requests." }, { property: "og:title", content: "Purchase Requests — KK GROUP ERP" }, { property: "og:description", content: "Track and approve project purchase requests." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: PrList,
});

const PAGE = 25;
const sel = "h-9 rounded-md border bg-background px-2 text-sm";
function fyOf(d: Date) { return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; }

function PrList() {
  const can = useCan();
  const sp = Route.useSearch();
  const [status, setStatus] = useState(sp.status ?? "");
  const [projectId, setProjectId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [priority, setPriority] = useState("");
  const [requester, setRequester] = useState("");
  const [fy, setFy] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [page, setPage] = useState(0);
  const cur = fyOf(new Date());

  const refs = useQuery({
    queryKey: ["pr-list-refs"],
    queryFn: async () => {
      const [p, b, u] = await Promise.all([
        supabase.from("projects").select("id,name,code").order("name"),
        supabase.from("buildings").select("id,name,project_id").order("name"),
        supabase.from("profiles").select("id,full_name,email").order("full_name"),
      ]);
      return { projects: p.data ?? [], buildings: b.data ?? [], people: u.data ?? [] };
    },
  });

  const q = useQuery({
    queryKey: ["prs", status, projectId, buildingId, priority, requester, fy, from, to, text, page, sp.due],
    queryFn: async () => {
      let r = supabase.from("purchase_requests").select("id,pr_number,request_date,required_by,estimated_total,priority,status,requested_by,projects(code,name),buildings(name)", { count: "exact" }).order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (status) r = r.eq("status", status as PrStatus);
      if (projectId) r = r.eq("project_id", projectId);
      if (buildingId) r = r.eq("building_id", buildingId);
      if (priority) r = r.eq("priority", priority as PrPriority);
      if (requester) r = r.eq("requested_by", requester);
      if (fy) r = r.gte("request_date", `${fy}-04-01`).lte("request_date", `${Number(fy) + 1}-03-31`);
      if (from) r = r.gte("request_date", from);
      if (to) r = r.lte("request_date", to);
      if (sp.due) { const d = new Date(); d.setDate(d.getDate() + 7); r = r.lte("required_by", d.toISOString().slice(0, 10)).in("status", ["draft", "pending_approval", "approved"]); }
      const t = safeSearch(text);
      if (t) {
        const ors = [`pr_number.ilike.%${t}%`];
        const [mat, proj, ppl] = await Promise.all([
          supabase.from("purchase_request_items").select("purchase_request_id, items!inner(name)").ilike("items.name", `%${t}%`).limit(200),
          supabase.from("projects").select("id").or(`name.ilike.%${t}%,code.ilike.%${t}%`),
          supabase.from("profiles").select("id").or(`full_name.ilike.%${t}%,email.ilike.%${t}%`),
        ]);
        const ids = [...new Set((mat.data ?? []).map((x) => x.purchase_request_id))];
        if (ids.length) ors.push(`id.in.(${ids.join(",")})`);
        if (proj.data?.length) ors.push(`project_id.in.(${proj.data.map((x) => x.id).join(",")})`);
        if (ppl.data?.length) ors.push(`requested_by.in.(${ppl.data.map((x) => x.id).join(",")})`);
        r = r.or(ors.join(","));
      }
      const { data, error, count } = await r;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const reset = () => setPage(0);
  const people = refs.data?.people ?? [];
  const who = (id: string) => { const p = people.find((x) => x.id === id); return p?.full_name ?? p?.email ?? "—"; };
  const pages = Math.max(1, Math.ceil((q.data?.count ?? 0) / PAGE));

  return (
    <>
      <PageHeader title="Purchase Requests" subtitle={`${q.data?.count ?? 0} requests${sp.due ? " · due within 7 days" : ""}`} actions={can("purchase_request.create") && <Button asChild size="sm"><Link to="/procurement/purchase-requests/new"><Plus className="h-4 w-4" />Purchase Request</Link></Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBox value={text} onChange={(v) => { setText(v); reset(); }} placeholder="PR number, material, project, requester" />
        <select className={sel} value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} aria-label="Status"><option value="">All statuses</option>{Object.entries(PR_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select className={sel} value={projectId} onChange={(e) => { setProjectId(e.target.value); setBuildingId(""); reset(); }} aria-label="Project"><option value="">All projects</option>{refs.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className={sel} value={buildingId} disabled={!projectId} onChange={(e) => { setBuildingId(e.target.value); reset(); }} aria-label="Building"><option value="">All buildings</option>{refs.data?.buildings.filter((b) => b.project_id === projectId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select className={sel} value={requester} onChange={(e) => { setRequester(e.target.value); reset(); }} aria-label="Requester"><option value="">All requesters</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}</select>
        <select className={sel} value={priority} onChange={(e) => { setPriority(e.target.value); reset(); }} aria-label="Priority"><option value="">All priorities</option>{Object.entries(PR_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className={sel} value={fy} onChange={(e) => { setFy(e.target.value); reset(); }} aria-label="Financial year"><option value="">All FY</option>{[cur + 1, cur, cur - 1, cur - 2].map((y) => <option key={y} value={y}>FY {y}–{String(y + 1).slice(2)}</option>)}</select>
        <Input type="date" className="h-9 w-auto" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} aria-label="From date" />
        <Input type="date" className="h-9 w-auto" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} aria-label="To date" />
      </div>
      {q.isLoading ? <Loading /> : q.error ? <div className="text-sm text-destructive">{errMsg(q.error)}</div> : q.data!.rows.length === 0 ? <Empty>No purchase requests match these filters.</Empty> : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">PR</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Building</th><th className="px-4 py-3">Requested by</th><th className="px-4 py-3">Required by</th><th className="px-4 py-3 text-right">Est. value</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr></thead>
            <tbody>
              {q.data!.rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium tabular-nums font-medium"><Link to="/procurement/purchase-requests/$id" params={{ id: r.id }} className="text-primary hover:underline">{r.pr_number}</Link></td>
                  <td className="px-4 py-3">{fmtDate(r.request_date)}</td>
                  <td className="px-4 py-3">{r.projects?.name}</td>
                  <td className="px-4 py-3">{r.buildings?.name ?? "—"}</td>
                  <td className="px-4 py-3">{who(r.requested_by)}</td>
                  <td className="px-4 py-3">{fmtDate(r.required_by)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{inr(r.estimated_total)}</td>
                  <td className="px-4 py-3">{PR_PRIORITY[r.priority]}</td>
                  <td className="px-4 py-3"><span className={`inline-flex whitespace-nowrap whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium font-medium ${PR_STATUS[r.status].cls}`}>{PR_STATUS[r.status].label}</span></td>
                  <td className="px-4 py-3 text-right"><Link to="/procurement/purchase-requests/$id" params={{ id: r.id }} className="text-xs text-primary hover:underline">Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex items-center justify-end gap-2 text-xs"><span className="text-muted-foreground">Page {page + 1} of {pages}</span><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>
    </>
  );
}
