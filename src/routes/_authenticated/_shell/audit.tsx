import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Loading } from "@/components/erp/common";
import { Input } from "@/components/ui/input";
import { fmtDateTime } from "@/lib/format";
import { selectCls } from "@/lib/po";

export const Route = createFileRoute("/_authenticated/_shell/audit")({
  head: () => ({ meta: [{ title: "Audit Log — KK Group ERP" }, { name: "description", content: "Immutable ERP change history." }, { property: "og:title", content: "Audit Log — KK Group ERP" }, { property: "og:description", content: "Immutable ERP change history." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Audit,
});

const DOC_TYPES = ["GRN", "PO", "Vendor invoice", "Finance settings"];

function Audit() {
  const [docType, setDocType] = useState("");
  const [action, setAction] = useState("");
  const [docNo, setDocNo] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useQuery({
    queryKey: ["audit", docType, action, docNo, from, to],
    queryFn: async () => {
      let r = supabase.from("audit_logs").select("id,action,entity,entity_id,created_at,actor_name,document_type,document_number,reason,old_data,new_data").order("created_at", { ascending: false }).limit(300);
      if (docType) r = r.eq("document_type", docType);
      if (action) r = r.eq("action", action);
      const n = docNo.replace(/[^A-Za-z0-9-]/g, "");
      if (n) r = r.ilike("document_number", `%${n}%`);
      if (from) r = r.gte("created_at", from);
      if (to) r = r.lte("created_at", `${to}T23:59:59`);
      const res = await r;
      if (res.error) throw res.error;
      return res.data;
    },
  });
  const actions = ["grn_created", "grn_posted", "grn_cancelled", "grn_reversed", "grn_line_edited", "invoice_submit", "disposition_decision", "short_close", "invoice_created", "invoice_matched", "invoice_approve", "invoice_reject", "invoice_cancel", "finance_settings_changed", "insert", "update", "delete"];
  return (
    <>
      <PageHeader title="Audit Log" subtitle="Permanent history. Entries cannot be edited or deleted." />
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <select aria-label="Document type" className={selectCls} value={docType} onChange={(e) => setDocType(e.target.value)}><option value="">All documents</option>{DOC_TYPES.map((d) => <option key={d}>{d}</option>)}</select>
        <select aria-label="Action" className={selectCls} value={action} onChange={(e) => setAction(e.target.value)}><option value="">All actions</option>{actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}</select>
        <Input placeholder="Document number" value={docNo} onChange={(e) => setDocNo(e.target.value)} />
        <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {q.isLoading ? <Loading /> : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card text-sm shadow-card">
          {q.data?.length === 0 && <div className="p-4 text-xs text-muted-foreground">No entries match.</div>}
          {q.data?.map((a) => (
            <details key={a.id} className="px-4 py-2">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1">
                <span className="w-36 font-mono text-xs text-muted-foreground">{fmtDateTime(a.created_at)}</span>
                <span className="font-medium">{a.action.replace(/_/g, " ")}</span>
                <span>{a.document_type ?? a.entity}{a.document_number ? <span className="ml-1 font-mono">{a.document_number}</span> : null}</span>
                <span className="text-xs text-muted-foreground">{a.actor_name ?? "—"}</span>
                {a.reason && <span className="text-xs italic">“{a.reason}”</span>}
              </summary>
              <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                <div><div className="text-muted-foreground">Before</div><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2">{a.old_data ? JSON.stringify(a.old_data, null, 1) : "—"}</pre></div>
                <div><div className="text-muted-foreground">After</div><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2">{a.new_data ? JSON.stringify(a.new_data, null, 1) : "—"}</pre></div>
                <div className="font-mono text-[10px] text-muted-foreground md:col-span-2">Record {a.entity_id}</div>
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
