/**
 * Read-only construction procurement indicators.
 *
 * Material receipts are recognised from ACCEPTED quantities, never raw GRN
 * received quantities (which can include damaged/rejected material).
 * PO-level freight, other charges and discounts are not allocated to lines,
 * so remaining line value is explicitly an estimate, not an AP balance.
 */
export const ACTIVE_DELIVERY_PO_STATUSES = [
  "approved", "sent", "partially_received", "partially_accepted",
] as const;

export type FollowupPoLine = {
  ordered_quantity: number;
  accepted_quantity: number;
  short_closed_quantity: number;
  line_total: number;
};

export type FollowupPo = {
  status: string;
  expected_delivery_date: string | null;
  purchase_order_items: FollowupPoLine[];
};

export type DeliveryPriority = "overdue" | "due_soon" | "unscheduled" | "on_track";

export type DeliverySnapshot = {
  priority: DeliveryPriority;
  openLines: number;
  totalLines: number;
  estimatedOpenLineValue: number;
  acceptancePercent: number;
  daysUntilDue: number | null;
};

/** Estimate PO MATERIAL line values, excluding unallocated PO-level charges.
 * This is NOT an amount payable to the vendor.
 */
export function purchaseOrderLineValues(lines: FollowupPoLine[]) {
  let openLines = 0;
  let committedLineValue = 0;
  let acceptedLineValue = 0;
  let openLineValue = 0;

  for (const item of lines) {
    const ordered = Math.max(0, Number(item.ordered_quantity) || 0);
    if (!ordered) continue;
    const shortClosed = Math.min(ordered, Math.max(0, Number(item.short_closed_quantity) || 0));
    const committed = ordered - shortClosed;
    const accepted = Math.min(committed, Math.max(0, Number(item.accepted_quantity) || 0));
    const remaining = Math.max(0, committed - accepted);
    const lineValue = Math.max(0, Number(item.line_total) || 0);

    committedLineValue += lineValue * committed / ordered;
    acceptedLineValue += lineValue * accepted / ordered;
    openLineValue += lineValue * remaining / ordered;
    if (remaining > 0.000_001) openLines++;
  }

  return {
    openLines,
    totalLines: lines.length,
    acceptedLineValue: Math.round(acceptedLineValue * 100) / 100,
    estimatedOpenLineValue: Math.round(openLineValue * 100) / 100,
    acceptancePercent: committedLineValue > 0
      ? Math.max(0, Math.min(100, Math.round(acceptedLineValue / committedLineValue * 100)))
      : 100,
  };
}

/** Calendar days, using ISO dates, not the viewer's local time zone. */
export function calendarDaysBetween(startIso: string, endIso: string): number {
  const a = Date.parse(startIso.slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(endIso.slice(0, 10) + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

export function deliverySnapshot(po: FollowupPo, todayIso: string): DeliverySnapshot | null {
  if (!ACTIVE_DELIVERY_PO_STATUSES.some(status => status === po.status)) return null;

  const values = purchaseOrderLineValues(po.purchase_order_items);
  if (!values.openLines) return null;
  const daysUntilDue = po.expected_delivery_date
    ? calendarDaysBetween(todayIso, po.expected_delivery_date)
    : null;
  const priority: DeliveryPriority = daysUntilDue === null ? "unscheduled"
    : daysUntilDue < 0 ? "overdue"
    : daysUntilDue <= 7 ? "due_soon" : "on_track";

  return {
    priority,
    openLines: values.openLines,
    totalLines: values.totalLines,
    estimatedOpenLineValue: values.estimatedOpenLineValue,
    acceptancePercent: values.acceptancePercent,
    daysUntilDue,
  };
}

export type FollowupInvoice = {
  status: string;
  match_status: string;
  due_date: string | null;
  balance_due: number;
};

/** Exception != approved payable; keep financial urgency categories distinct. */
export function needsInvoiceMatchReview(invoice: FollowupInvoice): boolean {
  if (["cancelled", "rejected", "paid"].includes(invoice.status)) return false;
  return invoice.status === "exception" || invoice.match_status === "exception";
}

export function isOverdueApprovedInvoice(invoice: FollowupInvoice, todayIso: string): boolean {
  return (invoice.status === "approved" || invoice.status === "partially_paid")
    && Number(invoice.balance_due) > 0
    && !!invoice.due_date
    && invoice.due_date < todayIso;
}
