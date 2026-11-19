import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { errMsg, fmtDateTime } from "@/lib/format";
import type { Json } from "@/integrations/supabase/types";

type DocumentKind = "purchase_request" | "rfq" | "purchase_order";
type Snapshot = { header?: Record<string, Json>; items?: Json[]; vendors?: Json[] };
const ignored = new Set(["id", "created_at", "updated_at", "purchase_request_id", "rfq_id", "po_id", "invited_at"]);

function normalize(value: Json[] | undefined): string {
  const rows = (value ?? []).map((raw) => {
    if (!raw || Array.isArray(raw) || typeof raw !== "object") return raw;
    return Object.fromEntries(Object.entries(raw).filter(([key]) => !ignored.has(key)));
  });
  return JSON.stringify(rows);
}

function changedFields(before: Json, after: Json): string[] {
  const prev = (before ?? {}) as Snapshot;
  const next = (after ?? {}) as Snapshot;
  const labels: string[] = [];
  const oldHeader = prev.header ?? {};
  const newHeader = next.header ?? {};
  for (const key of new Set([...Object.keys(oldHeader), ...Object.keys(newHeader)])) {
    if (ignored.has(key) || ["submitted_at", "submitted_by", "approved_at", "approved_by"].includes(key)) continue;
    if (JSON.stringify(oldHeader[key]) !== JSON.stringify(newHeader[key])) {
      labels.push(key.replace(/_/g, " "));
    }
  }
  if (normalize(prev.items) !== normalize(next.items)) labels.push("material / commercial lines");
  if (normalize(prev.vendors) !== normalize(next.vendors)) labels.push("invited vendors");
  return labels;
}

/** Append-only history, separate from workflow approvals. Database RLS scopes every row. */
export function ProcurementRevisionHistory({
  kind, documentId,
}: {
  kind: DocumentKind;
  documentId: string;
}) {
  const q = useQuery({
    queryKey: ["procurement-revisions", kind, documentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("procurement_document_revisions")
        .select("id,revision_no,actor_id,reason,created_at,before_snapshot,after_snapshot")
        .eq("document_type", kind)
        .eq("document_id", documentId)
        .order("revision_no", { ascending: false });
      if (error) throw error;
      const rows = data ?? [];
      const actors = [...new Set(rows.map((row) => row.actor_id))];
      if (!actors.length) return { rows, names: new Map<string, string>() };
      const profiles = await supabase.from("profiles")
        .select("id,full_name").in("id", actors);
      const names = new Map<string, string>((profiles.data ?? []).map((p) => [
        p.id, p.full_name ?? "Staff name unavailable",
      ]));
      return { rows, names };
    },
  });
  if (q.isLoading) return null;
  if (q.error) return (
    <div role="alert" className="mt-4 rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
      Revision history could not load: {errMsg(q.error)}
    </div>
  );
  if (!q.data?.rows.length) return null;
  return (
    <section className="mt-5 rounded-xl border bg-card p-4 shadow-sm" aria-label="Document revisions">
      <h2 className="text-sm font-semibold">Document revision history</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Same document number, with permanent before/after snapshots. Approval decisions remain in the separate workflow history.
      </p>
      <ol className="mt-3 space-y-3">
        {q.data.rows.map((record) => {
          const fields = changedFields(record.before_snapshot, record.after_snapshot);
          return (
            <li key={record.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>Revision {record.revision_no}</strong>
                <time className="text-xs tabular-nums text-muted-foreground" dateTime={record.created_at}>
                  {fmtDateTime(record.created_at)}
                </time>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                By {q.data!.names.get(record.actor_id) ?? "Staff name unavailable"}
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words">{record.reason}</p>
              {fields.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Updated: {fields.join(", ")}
                </p>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-primary">View saved before/after values</summary>
                <div className="mt-2 grid gap-3 lg:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold">Before</div>
                    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px]">
                      {JSON.stringify(record.before_snapshot, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold">After</div>
                    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px]">
                      {JSON.stringify(record.after_snapshot, null, 2)}
                    </pre>
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
