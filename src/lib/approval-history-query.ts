import { supabase } from "@/integrations/supabase/client";
import { loadCompleteRows } from "@/lib/complete-register";
import { voteFetchChunks, type ApprovalKind } from "@/lib/approval-queue";
import { mergeApprovalDecisions, type ApprovalDecision } from "@/lib/approval-history";

export type ApprovalHistoryDocument = {
  kind: ApprovalKind;
  id: string;
  approvedBy: string | null;
  approvedAt: string | null;
  approverName: string | null;
};

/** Read only the displayed documents, using the signed-in user's existing RLS. */
export async function loadApprovalDecisions(documents: ReadonlyArray<ApprovalHistoryDocument>): Promise<ApprovalDecision[]> {
  const batches = await Promise.all(voteFetchChunks(documents).map(async batch => {
    const [votes, events] = await Promise.all([
      loadCompleteRows(async (start, end) => await supabase.from("director_approval_votes")
        .select("id,entity_id,actor_id,decision,created_at,comment,actor:profiles(full_name)", { count: "exact" })
        .eq("entity_type", batch.kind).in("entity_id", batch.ids).order("created_at").order("id").range(start, end)),
      batch.kind === "purchase_order"
        ? loadCompleteRows(async (start, end) => await supabase.from("purchase_order_approvals")
          .select("id,po_id,acted_by,action,acted_at,comment,actor:profiles(full_name)", { count: "exact" })
          .in("po_id", batch.ids).in("action", ["approved", "rejected", "cancelled"]).order("acted_at").order("id").range(start, end))
          .then(rows => rows.map(row => ({ ...row, documentId: row.po_id })))
        : loadCompleteRows(async (start, end) => await supabase.from("vendor_payment_events")
          .select("id,payment_id,acted_by,action,acted_at,comment,actor:profiles(full_name)", { count: "exact" })
          .in("payment_id", batch.ids).in("action", ["approve", "cancel"]).order("acted_at").order("id").range(start, end))
          .then(rows => rows.map(row => ({ ...row, documentId: row.payment_id }))),
    ]);
    return [
      ...votes.filter(row => row.decision === "approved" || row.decision === "rejected").map(row => ({
        id: `vote-${row.id}`, source: "vote" as const, kind: batch.kind, documentId: row.entity_id, actorId: row.actor_id,
        actorName: row.actor?.full_name ?? null, decision: row.decision as "approved" | "rejected",
        occurredAt: row.created_at, comment: row.comment,
      })),
      ...events.map(row => ({
        id: `event-${row.id}`, source: "transition" as const, kind: batch.kind, documentId: row.documentId, actorId: row.acted_by,
        actorName: row.actor?.full_name ?? null,
        decision: (row.action === "cancel" || row.action === "cancelled" ? "cancelled" : row.action === "rejected" ? "rejected" : "approved") as ApprovalDecision["decision"],
        occurredAt: row.acted_at, comment: row.comment,
      })),
    ];
  }));
  const rows: ApprovalDecision[] = batches.flat();
  for (const doc of documents) {
    if (doc.approvedAt && !rows.some(row => row.kind === doc.kind && row.documentId === doc.id && row.decision === "approved")) {
      rows.push({ id: `approval-${doc.id}`, source: "record", kind: doc.kind, documentId: doc.id, actorId: doc.approvedBy,
        actorName: doc.approverName, decision: "approved", occurredAt: doc.approvedAt, comment: null });
    }
  }
  return mergeApprovalDecisions(rows);
}
