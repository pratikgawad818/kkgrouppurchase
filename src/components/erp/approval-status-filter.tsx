import type { ApprovalKind } from "@/lib/approval-queue";
import type { ApprovalView } from "@/lib/approval-history";

export function ApprovalStatusFilter({ kind, value, onChange }: {
  kind: ApprovalKind;
  value: ApprovalView;
  onChange: (view: ApprovalView) => void;
}) {
  return <label className="flex items-center gap-2 text-xs font-medium">Status
    <select aria-label="Approval status" className="h-11 rounded-full border bg-card px-3 text-sm sm:h-9" value={value} onChange={event => onChange(event.target.value as ApprovalView)}>
      <option value="pending">Pending</option><option value="approved">Approved</option>
      {kind === "purchase_order" && <option value="rejected">Rejected</option>}
      <option value="cancelled">Cancelled</option>
    </select>
  </label>;
}
