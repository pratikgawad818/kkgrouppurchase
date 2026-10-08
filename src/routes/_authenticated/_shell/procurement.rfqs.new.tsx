import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loading, PageHeader } from "@/components/erp/common";
import { errMsg, num } from "@/lib/format";
import { useCan, useMe } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/_shell/procurement/rfqs/new")({
  validateSearch: (s: Record<string, unknown>) => ({ pr: typeof s["pr"] === "string" ? s["pr"] : undefined }),
  head: () => ({ meta: [{ title: "New RFQ — KK GROUP ERP" }, { name: "description", content: "Create a request for quotation from an approved purchase request." }, { property: "og:title", content: "New RFQ — KK GROUP ERP" }, { property: "og:description", content: "Create a request for quotation from an approved purchase request." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: NewRfq,
});

function NewRfq() {
  const { pr: initialPr } = Route.useSearch();
  const can = useCan();
  const me = useMe();
  const nav = useNavigate();
  const [prId, setPrId] = useState(initialPr ?? "");
  const [due, setDue] = useState(() => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [vendors, setVendors] = useState<string[]>([]);
  const [vsearch, setVsearch] = useState("");

  const refs = useQuery({
    queryKey: ["rfq-refs"],
    queryFn: async () => {
      const [p, v] = await Promise.all([
        supabase.from("purchase_requests").select("id,pr_number,required_by,projects(code,name)").eq("status", "approved").order("created_at", { ascending: false }).limit(500),
        supabase.from("vendors").select("id,code,company_name,contact_person,mobile,city,vendor_category_links(vendor_categories(name))").eq("status", "active").order("company_name"),
      ]);
      if (p.error) throw p.error;
      if (v.error) throw v.error;
      return { prs: p.data ?? [], vendors: v.data ?? [] };
    },
  });
  const items = useQuery({
    queryKey: ["rfq-pr-items", prId],
    enabled: !!prId,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_request_items").select("*, items(code,name), units_of_measure(code)").eq("purchase_request_id", prId).order("line_no");
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const pr = refs.data!.prs.find((p) => p.id === prId);
      if (!pr) throw new Error("Choose an approved purchase request");
      if (!vendors.length) throw new Error("Invite at least one vendor");
      const { data: rfq, error } = await supabase.from("rfqs").insert({
        purchase_request_id: prId, response_due_date: due, required_by_date: pr.required_by, remarks: remarks || null,
        created_by: me.data!.profile.id,
        company_id: "00000000-0000-0000-0000-000000000000", project_id: "00000000-0000-0000-0000-000000000000",
      }).select("id").single();
      if (error) throw error;
      const lines = (items.data ?? []).map((x, i) => ({ rfq_id: rfq.id, pr_item_id: x.id, line_no: i + 1, material_id: x.material_id, description: x.description, requested_quantity: x.quantity, unit_id: x.unit_id, target_rate: x.estimated_rate, required_by: x.required_by }));
      const a = await supabase.from("rfq_items").insert(lines);
      if (a.error) throw a.error;
      const b = await supabase.from("rfq_vendors").insert(vendors.map((v) => ({ rfq_id: rfq.id, vendor_id: v })));
      if (b.error) throw b.error;
      return rfq.id;
    },
    onSuccess: (id) => { toast.success("RFQ draft created"); nav({ to: "/procurement/rfqs/$id", params: { id } }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (!can("rfq.create")) return <div className="text-sm text-muted-foreground">You do not have permission to create RFQs.</div>;
  if (refs.isLoading) return <Loading />;
  if (refs.error) return <div className="text-sm text-destructive">{errMsg(refs.error)}</div>;
  const vs = refs.data!.vendors.filter((v) => !vsearch || `${v.company_name} ${v.code} ${v.city ?? ""}`.toLowerCase().includes(vsearch.toLowerCase()));

  return (
    <>
      <PageHeader crumbs={<Link to="/procurement/rfqs">RFQs</Link>} title="New RFQ" subtitle="Items and project are taken from the approved purchase request." />
      <section className="grid gap-4 rounded-md border bg-card p-4 sm:grid-cols-3">
        <label className="text-sm sm:col-span-2">Approved purchase request
          <select className="mt-1 h-9 w-full rounded-md border bg-background px-2" value={prId} onChange={(e) => setPrId(e.target.value)}>
            <option value="">Select…</option>
            {refs.data!.prs.map((p) => <option key={p.id} value={p.id}>{p.pr_number} · {p.projects?.code} {p.projects?.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Response due date<Input className="mt-1" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <label className="text-sm sm:col-span-3">Remarks / terms for vendors<Textarea className="mt-1" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
      </section>

      {prId && (
        <section className="mt-4 overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
          <h2 className="p-3 text-sm font-semibold">Items requested</h2>
          <table className="w-full text-sm">
            <thead className="border-y bg-muted/40 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Material</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3">Unit</th></tr></thead>
            <tbody>{(items.data ?? []).map((x) => <tr key={x.id} className="border-b last:border-0 hover:bg-muted/40"><td className="px-4 py-3">{x.line_no}</td><td className="px-4 py-3">{x.items?.name} <span className="text-xs text-muted-foreground">{x.items?.code}</span></td><td className="px-4 py-3 text-right font-medium tabular-nums">{num(x.quantity)}</td><td className="px-4 py-3">{x.units_of_measure?.code}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      <section className="mt-4 rounded-md border bg-card p-4">
        <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Invite vendors ({vendors.length} selected)</h2><Input className="w-56" placeholder="Search vendors" value={vsearch} onChange={(e) => setVsearch(e.target.value)} /></div>
        <div className="grid max-h-80 gap-1 overflow-y-auto sm:grid-cols-2">
          {vs.map((v) => (
            <label key={v.id} className="flex cursor-pointer items-start gap-2 rounded border p-2 text-sm hover:bg-muted/40">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={vendors.includes(v.id)} onChange={(e) => setVendors(e.target.checked ? [...vendors, v.id] : vendors.filter((x) => x !== v.id))} />
              <span><span className="font-medium">{v.company_name}</span> <span className="text-xs text-muted-foreground">{v.code}</span>
                <span className="block text-xs text-muted-foreground">{(v.vendor_category_links ?? []).map((l) => l.vendor_categories?.name).filter(Boolean).join(", ")}{v.contact_person ? ` · ${v.contact_person}` : ""}{v.mobile ? ` · ${v.mobile}` : ""}</span></span>
            </label>
          ))}
        </div>
      </section>
      <div className="mt-4 flex justify-end"><Button disabled={save.isPending || !prId || !vendors.length || !items.data?.length} onClick={() => save.mutate()}>Create RFQ draft</Button></div>
    </>
  );
}
