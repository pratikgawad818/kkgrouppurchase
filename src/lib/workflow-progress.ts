/**
 * Read-only explanation of audited ERP workflow state.
 *
 * Approval actors are identified only from persisted history entries.
 * Future owners are shown as ROLES, never invented staff assignments.
 * These descriptions do not grant access or alter server-side transitions.
 */
export type WorkflowKind = "purchase_request" | "purchase_order" | "vendor_payment";
export type WorkflowStageState = "complete" | "current" | "upcoming" | "stopped";

export type WorkflowEvent = {
  id: string;
  action: string;
  occurredAt: string;
  actorName?: string | null;
  comment?: string | null;
  newStatus?: string | null;
  reference?: string | null;
  referencePath?: string | null;
};

export type WorkflowStage = {
  key: string;
  label: string;
  state: WorkflowStageState;
};

export type WorkflowPresentation = {
  stateLabel: string;
  stages: WorkflowStage[];
  nextTitle: string | null;
  nextOwner: string | null;
  nextDescription: string;
  finished: boolean;
  blocked: boolean;
};

const progress = (
  labels: readonly string[],
  completeCount: number,
  activeIndex: number | null,
  stoppedIndex: number | null = null,
): WorkflowStage[] => labels.map((label, index) => ({
  key: String(index),
  label,
  state: stoppedIndex === index ? "stopped" :
    index < completeCount ? "complete" :
    index === activeIndex ? "current" : "upcoming",
}));

const TERMINATED = new Set(["cancelled", "rejected"]);

export function workflowPresentation(
  kind: WorkflowKind,
  status: string,
  rfqStatuses?: readonly string[],
  lastAction?: string | null,
): WorkflowPresentation {
  if (kind === "purchase_request") {
    const labels = ["Prepare request", "Procurement review", "Vendor quotations", "Purchase order"];
    if (TERMINATED.has(status)) return {
      stateLabel: status === "cancelled" ? "Cancelled" : "Rejected",
      stages: progress(labels, 1, null, 1),
      nextTitle: null, nextOwner: null,
      nextDescription: status === "cancelled"
        ? "This request was cancelled; no further purchasing action is scheduled."
        : "This request was rejected; a new request is required if materials are still needed.",
      finished: true, blocked: true,
    };
    if (status === "draft") return {
      stateLabel: lastAction === "returned" ? "Returned for correction" : "Draft",
      stages: progress(labels, 0, 0),
      nextTitle: lastAction === "returned" ? "Correct and resubmit this request" : "Complete and submit the request",
      nextOwner: "Request creator / Site Engineer",
      nextDescription: lastAction === "returned"
        ? "Review the reason in the history below, update the draft and resubmit it for approval."
        : "Finish the required materials, quantities and purpose, then submit for review.",
      finished: false, blocked: lastAction === "returned",
    };
    if (status === "pending_approval") return {
      stateLabel: "Awaiting purchasing review",
      stages: progress(labels, 1, 1),
      nextTitle: "Review and receive the purchase request",
      nextOwner: "Purchase Manager / Super Admin / Director",
      nextDescription: "An authorized reviewer other than the requester must receive this PR for procurement or return it for correction. Director approval of the resulting PO is a separate stage; no individual has been assigned by this display.",
      finished: false, blocked: false,
    };
    if (status === "approved") {
      const hasVisibleRFQ = rfqStatuses !== undefined;
      const rfqReady = rfqStatuses?.some((s) => s === "ready_for_po");
      const rfqSent = rfqStatuses?.some((s) => ["sent", "partially_responded", "fully_responded"].includes(s));
      const rfqDraft = rfqStatuses?.some((s) => s === "draft");
      const rfqCancelled = rfqStatuses?.length && rfqStatuses.every((s) => s === "cancelled");
      const rfqClosed = rfqStatuses?.some((s) => s === "closed");
      const selectedQuotes = rfqStatuses?.some((s) => s === "fully_responded");
      let nextTitle = "Manage RFQ and vendor quotations";
      let nextDescription = "Procurement can issue an RFQ, collect quotations and prepare the next Purchase Order.";
      if (hasVisibleRFQ && rfqStatuses.length === 0) {
        nextTitle = "Create the RFQ";
        nextDescription = "The purchase request has been received for procurement and is ready for staff to create an RFQ.";
      } else if (rfqReady) {
        nextTitle = "Continue Purchase Order processing";
        nextDescription = "A linked RFQ is ready for PO processing. Procurement should check for an existing PO before creating another.";
      } else if (rfqClosed) {
        nextTitle = "Check linked PO and RFQ closeout";
        nextDescription = "A linked RFQ is closed. Procurement should review the related PO, if one exists, and confirm the next delivery step.";
      } else if (selectedQuotes) {
        nextTitle = "Compare quotations and select the supplier";
        nextDescription = "All invited supplier responses are recorded; procurement must compare and select quotations.";
      } else if (rfqSent) {
        nextTitle = "Collect and review supplier quotations";
        nextDescription = "Procurement is managing an issued RFQ and supplier responses.";
      } else if (rfqDraft) {
        nextTitle = "Send the prepared RFQ";
        nextDescription = "A linked RFQ draft is available for procurement to send to vendors.";
      } else if (rfqCancelled) {
        nextTitle = "Review cancelled RFQ and plan a replacement";
        nextDescription = "The visible RFQs are cancelled; procurement must decide how to proceed.";
      }
      return {
        stateLabel: "PR received for procurement",
        stages: progress(labels, rfqReady || rfqClosed ? 3 : 2, rfqReady || rfqClosed ? 3 : 2),
        nextTitle, nextOwner: "Authorized procurement staff",
        nextDescription, finished: false, blocked: false,
      };
    }
    return {
      stateLabel: "Status requires review",
      stages: progress(labels, 0, null),
      nextTitle: "Verify request status", nextOwner: "ERP administrator",
      nextDescription: "This request's current status is not covered by the workflow display.",
      finished: false, blocked: true,
    };
  }

  if (kind === "purchase_order") {
    const labels = ["Prepare PO", "Director approval", "Send to vendor", "Receive goods", "Reconcile & close"];
    if (status === "cancelled") return {
      stateLabel: "PO cancelled",
      stages: progress(labels, 1, null, 1),
      nextTitle: null, nextOwner: null,
      nextDescription: "The Purchase Order is cancelled. No new approval or delivery action is expected.",
      finished: true, blocked: true,
    };
    if (status === "draft" || status === "rejected") return {
      stateLabel: status === "rejected" ? "PO rejected — revision needed" : "Draft PO",
      stages: progress(labels, 0, 0),
      nextTitle: status === "rejected" ? "Revise the PO and resubmit" : "Complete and submit the PO",
      nextOwner: "Purchase Manager / PO creator",
      nextDescription: status === "rejected"
        ? "Address the rejection reason shown below, update the draft and submit again."
        : "Confirm delivery store, item values and supporting quotations before submitting.",
      finished: false, blocked: status === "rejected",
    };
    if (status === "pending_approval") return {
      stateLabel: "Awaiting Director approval",
      stages: progress(labels, 1, 1),
      nextTitle: "Approve or reject this PO",
      nextOwner: "Independent Director",
      nextDescription: "A Director who did not create this order must review the details and supporting quotation.",
      finished: false, blocked: false,
    };
    if (status === "approved") return {
      stateLabel: "Approved by Director",
      stages: progress(labels, 2, 2),
      nextTitle: "Send the approved PO to the vendor",
      nextOwner: "Purchase Manager / authorized purchasing staff",
      nextDescription: "Share the approved Purchase Order with the supplier, then mark it as sent.",
      finished: false, blocked: false,
    };
    if (status === "sent") return {
      stateLabel: "Sent to vendor",
      stages: progress(labels, 3, 3),
      nextTitle: "Receive and verify delivered goods",
      nextOwner: "Site Engineer / Store team",
      nextDescription: "Record goods received using delivery challans and GRNs; verify accepted, damaged and rejected quantities.",
      finished: false, blocked: false,
    };
    if (status === "partially_received" || status === "partially_accepted") return {
      stateLabel: status === "partially_received" ? "Partially received" : "Partially accepted",
      stages: progress(labels, 3, 3),
      nextTitle: "Resolve pending delivery quantities",
      nextOwner: "Store team / Purchase Manager",
      nextDescription: "Post further GRNs or resolve shortages, damage and replacements before final reconciliation.",
      finished: false, blocked: false,
    };
    if (["fully_received", "short_closed"].includes(status)) return {
      stateLabel: status === "fully_received" ? "Goods fully received" : "Short closed",
      stages: progress(labels, 4, 4),
      nextTitle: "Reconcile and close the order",
      nextOwner: "Purchase Manager / Accounts team",
      nextDescription: "Verify quantities, invoices and any outstanding claims before closing the order.",
      finished: false, blocked: false,
    };
    if (status === "closed") return {
      stateLabel: "PO closed",
      stages: progress(labels, 5, null),
      nextTitle: null, nextOwner: null,
      nextDescription: "The Purchase Order is closed. Its past approvals and goods receipts remain in the history.",
      finished: true, blocked: false,
    };
    return {
      stateLabel: "Status requires review", stages: progress(labels, 0, null),
      nextTitle: "Verify PO status", nextOwner: "ERP administrator",
      nextDescription: "This Purchase Order status is not covered by the workflow display.",
      finished: false, blocked: true,
    };
  }

  const labels = ["Schedule payment", "Director approval", "Record transfer"];
  if (status === "scheduled") return {
    stateLabel: "Awaiting payment approval",
    stages: progress(labels, 1, 1),
    nextTitle: "Approve the scheduled payment",
    nextOwner: "Independent Director",
    nextDescription: "An eligible Director other than the payment creator must review and approve it.",
    finished: false, blocked: false,
  };
  if (status === "approved") return {
    stateLabel: "Payment approved",
    stages: progress(labels, 2, 2),
    nextTitle: "Record the actual payment",
    nextOwner: "Accounts Manager / authorized finance staff",
    nextDescription: "Confirm the transfer or cheque, enter the transaction reference and record payment.",
    finished: false, blocked: false,
  };
  if (status === "recorded") return {
    stateLabel: "Payment recorded",
    stages: progress(labels, 3, null),
    nextTitle: null, nextOwner: null,
    nextDescription: "The payment is recorded. The approval and payment actions remain auditable.",
    finished: true, blocked: false,
  };
  if (status === "cancelled") return {
    stateLabel: "Payment cancelled",
    stages: progress(labels, 1, null, 1),
    nextTitle: null, nextOwner: null,
    nextDescription: "The scheduled payment was cancelled. No further payment action is expected.",
    finished: true, blocked: true,
  };
  return {
    stateLabel: "Status requires review",
    stages: progress(labels, 0, null),
    nextTitle: "Verify payment status", nextOwner: "ERP administrator",
    nextDescription: "This payment status is not covered by the workflow display.",
    finished: false, blocked: true,
  };
}

const ACTION_LABELS: Record<WorkflowKind, Record<string, string>> = {
  purchase_request: {
    created: "Request created",
    submitted: "PR requested",
    approved: "PR received for procurement",
    returned: "Returned for correction",
    rejected: "Request rejected",
    cancelled: "Request cancelled",
  },
  purchase_order: {
    created: "Purchase Order created",
    submitted: "Submitted for Director approval",
    approved: "Purchase Order approved",
    rejected: "Purchase Order rejected",
    sent: "Sent to vendor",
    cancelled: "Purchase Order cancelled",
    closed: "Purchase Order closed",
    goods_received: "Goods receipt recorded",
    goods_cancelled: "Goods receipt cancelled",
  },
  vendor_payment: {
    schedule: "Payment scheduled",
    scheduled: "Payment scheduled",
    approve: "Payment approved",
    approved: "Payment approved",
    record: "Payment recorded",
    cancel: "Payment cancelled",
  },
};

export function workflowEventTitle(kind: WorkflowKind, event: WorkflowEvent): string {
  if (event.action === "submitted" && event.newStatus === "approved") {
    return kind === "purchase_order" ? "PO finalized by creating Director"
      : "Request finalized by creating Director";
  }
  // Director-authored PRs can be finalized directly; do not attribute that
  // special path to the Purchase Manager simply because its status is approved.
  if (kind === "purchase_request" && event.action === "approved" &&
      event.comment?.includes("Finalized by the requesting Director")) {
    return "Request finalized by requesting Director";
  }
  return ACTION_LABELS[kind][event.action] ?? event.action.replaceAll("_", " ");
}

export function workflowEventTone(event: WorkflowEvent): "success" | "warning" | "neutral" {
  if (["approved", "goods_received", "record", "closed"].includes(event.action) ||
      (event.action === "submitted" && event.newStatus === "approved")) return "success";
  if (["returned", "rejected", "cancelled", "cancel", "goods_cancelled"].includes(event.action))
    return "warning";
  return "neutral";
}

/** Stable chronological order; preserve events in the same millisecond. */
export function chronologicalWorkflowEvents(events: readonly WorkflowEvent[]): WorkflowEvent[] {
  return [...events].sort((a, b) =>
    Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id.localeCompare(b.id),
  );
}
