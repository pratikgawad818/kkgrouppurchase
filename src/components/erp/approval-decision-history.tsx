import type { ApprovalDecision } from "@/lib/approval-history";
import { fmtDateTime } from "@/lib/format";

const labels = { approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" };

function Decision({ row }: { row: ApprovalDecision }) {
  return <div className="min-w-0 text-xs">
    <p className="font-medium">{labels[row.decision]} by {row.actorName || "Staff name unavailable"}</p>
    <time dateTime={row.occurredAt} className="text-muted-foreground">{fmtDateTime(row.occurredAt)}</time>
    {row.comment && <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{row.comment}</p>}
  </div>;
}

export function ApprovalDecisionHistory({ rows }: { rows: ReadonlyArray<ApprovalDecision> }) {
  const latest = rows.at(-1);
  if (!latest) return <p className="text-xs text-muted-foreground">No decision recorded yet.</p>;
  return <div className="rounded-lg border bg-muted/20 p-3">
    <Decision row={latest} />
    {rows.length > 1 && <details className="mt-1">
      <summary className="flex min-h-11 cursor-pointer items-center text-xs font-medium text-primary">View all decisions ({rows.length})</summary>
      <ol className="space-y-3 border-l pl-3">{rows.map(row => <li key={row.id}><Decision row={row} /></li>)}</ol>
    </details>}
  </div>;
}
