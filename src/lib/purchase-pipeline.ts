import type { TaskGroup, WorkspaceTask } from "@/lib/workspace-tasks";

/**
 * Pure, read-only dashboard projection over RLS-visible procurement rows.
 * No parent is fetched by an identifier after access checks. Documents and
 * links are only exposed if their corresponding module query was permitted.
 */
export type PipePR = {
  id: string; number: string; purpose: string | null; status: string;
  due: string | null; project: string;
};
export type PipeRFQ = {
  id: string; number: string; status: string; due: string | null;
  prId: string | null; project: string;
};
export type PipePO = {
  id: string; number: string; status: string; due: string | null;
  prId: string | null; rfqId: string | null;
  vendor: string | null; project: string;
};
export type PipeDoc = {
  id: string; number: string; status: string; poId: string;
  date?: string | null;
};
export type PipeInvoice = {
  id: string; number: string; status: string; due: string | null;
  poId: string | null; vendor: string | null; project: string;
  balanceDue: number; amountPaid: number; advanceAdjusted: number;
};
export type PipePayment = {
  id: string; number: string; status: string; due: string | null;
  invoiceIds: string[]; vendor: string | null; project: string;
};
export type PipelineInput = {
  prs: PipePR[]; rfqs: PipeRFQ[]; pos: PipePO[];
  challans: PipeDoc[]; grns: PipeDoc[];
  invoices: PipeInvoice[]; payments: PipePayment[];
};

export type StepKey = "request" | "rfq" | "order" | "delivery" | "invoice" | "payment";
export type PipelineDocument = { number: string; href: string };
export type PipelineStep = {
  key: StepKey;
  label: string;
  documents: PipelineDocument[];
  state: "done" | "current" | "todo";
};
export type PurchaseChain = WorkspaceTask & {
  stage: string;
  steps: PipelineStep[];
  vendor?: string | null;
};

const STEP_KEYS: StepKey[] = ["request", "rfq", "order", "delivery", "invoice", "payment"];
const LABELS: Record<StepKey, string> = {
  request: "PR", rfq: "RFQ", order: "PO",
  delivery: "Challan / GRN", invoice: "Invoice", payment: "Payment",
};
const ACTIVE_PO = new Set([
  "draft", "rejected", "pending_approval", "approved", "sent",
  "partially_received", "partially_accepted", "fully_received", "short_closed",
]);
const ACTIVE_PR = new Set(["draft", "pending_approval", "approved", "rejected"]);
const ACTIVE_RFQ = new Set([
  "draft", "sent", "partially_responded", "fully_responded", "ready_for_po",
]);
const ACTIVE_PAYMENT = new Set(["scheduled", "approved"]);
const VISIBLE_INVOICE = new Set([
  "draft", "pending_review", "exception", "approved",
  "partially_paid", "paid", "rejected",
]);
const INVOICE_NEEDS_REVIEW = new Set(["draft", "pending_review", "exception", "rejected"]);
const RECEIVED_PO = new Set(["fully_received", "short_closed"]);
const CANCELLED = "cancelled";

const route = {
  pr: (id: string) => "/procurement/purchase-requests/" + encodeURIComponent(id),
  rfq: (id: string) => "/procurement/rfqs/" + encodeURIComponent(id),
  po: (id: string) => "/procurement/purchase-orders/" + encodeURIComponent(id),
  challan: (id: string) => "/inventory/delivery-challans/" + encodeURIComponent(id),
  grn: (id: string) => "/inventory/goods-received/" + encodeURIComponent(id),
  invoice: (id: string) => "/finance/vendor-invoices/" + encodeURIComponent(id),
  payment: (id: string) => "/finance/payments/" + encodeURIComponent(id),
};
type Docs = Partial<Record<StepKey, PipelineDocument[]>>;
type Stage = {
  current: StepKey;
  kind: WorkspaceTask["kind"];
  stage: string;
  action: string;
  href: string;
  due: string | null;
};

function doc(number: string, url: string): PipelineDocument {
  return { number, href: url };
}
function timeline(docs: Docs, current: StepKey): PipelineStep[] {
  const currentIndex = STEP_KEYS.indexOf(current);
  return STEP_KEYS.map((key, index) => ({
    key,
    label: LABELS[key],
    documents: docs[key] ?? [],
    // A missing or inaccessible stage must never be shown as completed.
    state: index === currentIndex ? "current"
      : index < currentIndex && !!docs[key]?.length ? "done" : "todo",
  }));
}
function makeChain(
  key: string, docs: Docs, stage: Stage, description: string, project: string,
): PurchaseChain {
  const group: TaskGroup =
    stage.current === "invoice" || stage.current === "payment" ? "payments" : "purchasing";
  const first = docs.request?.[0] ?? docs.rfq?.[0] ?? docs.order?.[0] ??
    docs.delivery?.[0] ?? docs.invoice?.[0] ?? docs.payment?.[0];
  return {
    id: key,
    kind: stage.kind,
    group,
    number: first?.number ?? "",
    description,
    project,
    due: stage.due,
    action: stage.action,
    href: stage.href,
    stage: stage.stage,
    steps: timeline(docs, stage.current),
  };
}
function indexBy<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    const group = map.get(k) ?? [];
    group.push(item);
    map.set(k, group);
  }
  return map;
}
function isInvoicePaid(invoice: PipeInvoice) {
  if (invoice.status === "paid") return true;
  // Never hide a purchase just because one scheduled payment was approved or
  // one of several invoices was paid. The persisted invoice balance is the
  // financial source of truth.
  return ["approved", "partially_paid"].includes(invoice.status)
    && Number.isFinite(invoice.balanceDue)
    && invoice.balanceDue <= 0
    && invoice.amountPaid + invoice.advanceAdjusted > 0;
}
function latestDocs<T extends { number: string; id: string }>(
  list: T[], path: (id: string) => string,
) {
  return list.map(item => doc(item.number, path(item.id)));
}
function invoiceStage(inv: PipeInvoice): string {
  switch (inv.status) {
    case "draft": return "Invoice draft — finish entry";
    case "pending_review": return "Invoice awaiting review";
    case "exception": return "Invoice mismatch — resolve exception";
    case "rejected": return "Invoice returned — correct and resubmit";
    case "partially_paid": return "Part paid — balance outstanding";
    default: return "Invoice approved — schedule payment";
  }
}
function reviewPriority(inv: PipeInvoice): number {
  switch (inv.status) {
    case "exception": return 0;
    case "rejected": return 1;
    case "pending_review": return 2;
    case "draft": return 3;
    case "partially_paid": return 4;
    case "approved": return 5;
    default: return 6;
  }
}

/** A purchase is one live PO; an unmatched PR/RFQ/invoice/payment is standalone. */
export function buildPurchaseChains(input: PipelineInput): PurchaseChain[] {
  const result: PurchaseChain[] = [];
  const prById = new Map(input.prs.map(p => [p.id, p]));
  const rfqById = new Map(input.rfqs.map(r => [r.id, r]));
  const invoiceById = new Map(input.invoices.map(i => [i.id, i]));
  const invoicesByPo = indexBy(input.invoices, invoice => invoice.poId);
  const challansByPo = indexBy(input.challans, c => c.poId);
  const grnsByPo = indexBy(input.grns, g => g.poId);
  const paymentsByInvoice = new Map<string, PipePayment[]>();
  for (const payment of input.payments) {
    if (payment.status === CANCELLED) continue;
    for (const id of new Set(payment.invoiceIds)) {
      if (!invoiceById.has(id)) continue; // Never join a hidden invoice.
      const group = paymentsByInvoice.get(id) ?? [];
      group.push(payment);
      paymentsByInvoice.set(id, group);
    }
  }
  const coveredPr = new Set<string>();
  const coveredRfq = new Set<string>();
  const coveredInvoices = new Set<string>();
  const coveredPayments = new Set<string>();
  const coveredDeliveries = new Set<string>();
  const visiblePoIds = new Set(input.pos.map(po => po.id));

  for (const po of input.pos) {
    const rfq = po.rfqId ? rfqById.get(po.rfqId) : undefined;
    const pr = prById.get(po.prId ?? rfq?.prId ?? "");
    // A completed/cancelled PO must still suppress its old PR/RFQ and linked
    // invoices. Otherwise the dashboard resurrects the same purchase as an
    // orphan request or invoice when the PO disappears from attention.
    if (pr) coveredPr.add(pr.id);
    if (rfq) coveredRfq.add(rfq.id);
    const invoices = (invoicesByPo.get(po.id) ?? []).filter(i => i.status !== CANCELLED);
    const allInvoices = invoicesByPo.get(po.id) ?? [];
    for (const invoice of allInvoices) coveredInvoices.add(invoice.id);
    const challans = (challansByPo.get(po.id) ?? []).filter(c => c.status !== CANCELLED);
    const grns = (grnsByPo.get(po.id) ?? []).filter(g => g.status !== CANCELLED);
    for (const item of [...(challansByPo.get(po.id) ?? []), ...(grnsByPo.get(po.id) ?? [])]) {
      coveredDeliveries.add(item.id);
    }

    const payments = [...new Map(invoices.flatMap(i => paymentsByInvoice.get(i.id) ?? [])
      .map(pay => [pay.id, pay])).values()];
    payments.forEach(p => coveredPayments.add(p.id));

    if (!ACTIVE_PO.has(po.status)) continue;
    const allSettled = invoices.length > 0 && invoices.every(isInvoicePaid);
    if (RECEIVED_PO.has(po.status) && allSettled) continue;

    const docs: Docs = {
      ...(pr && { request: [doc(pr.number, route.pr(pr.id))] }),
      ...(rfq && { rfq: [doc(rfq.number, route.rfq(rfq.id))] }),
      order: [doc(po.number, route.po(po.id))],
      ...(challans.length || grns.length
        ? { delivery: [
          ...latestDocs(challans, route.challan),
          ...latestDocs(grns, route.grn),
        ] } : {}),
      ...(invoices.length && { invoice: latestDocs(invoices, route.invoice) }),
      ...(payments.length && { payment: latestDocs(payments, route.payment) }),
    };
    const description = pr?.purpose || "Purchase order " + po.number;
    const project = po.project || pr?.project || rfq?.project || "Project";
    const needingReview = invoices.filter(i => INVOICE_NEEDS_REVIEW.has(i.status))
      .sort((a, b) => reviewPriority(a) - reviewPriority(b))[0];
    const unpaid = invoices.filter(i => !isInvoicePaid(i))
      .sort((a, b) => reviewPriority(a) - reviewPriority(b));
    const outstandingInvoice = unpaid[0];
    const pendingPayment = payments.find(p => ACTIVE_PAYMENT.has(p.status));
    const hasRecordedPayment = payments.some(p => p.status === "recorded");
    let stage: Stage;

    if (needingReview) {
      stage = {
        current: "invoice", kind: "invoice", stage: invoiceStage(needingReview),
        action: "View invoice", href: route.invoice(needingReview.id),
        due: needingReview.due,
      };
    } else if (pendingPayment) {
      stage = {
        current: "payment", kind: "payment",
        stage: pendingPayment.status === "approved"
          ? "Payment approved — record transaction"
          : "Payment scheduled — waiting for approval",
        action: "View payment", href: route.payment(pendingPayment.id),
        due: pendingPayment.due,
      };
    } else if (outstandingInvoice) {
      const partlyPaid = outstandingInvoice.status === "partially_paid" ||
        outstandingInvoice.amountPaid > 0 || outstandingInvoice.advanceAdjusted > 0 ||
        hasRecordedPayment;
      stage = {
        current: "payment", kind: "payment",
        stage: partlyPaid ? "Part paid — balance outstanding" : "Invoice approved — schedule payment",
        action: partlyPaid && payments.length ? "View payment" : "View invoice",
        href: partlyPaid && payments.length
          ? route.payment(payments[payments.length - 1]!.id)
          : route.invoice(outstandingInvoice.id),
        due: outstandingInvoice.due,
      };
    } else if (invoices.length && allSettled) {
      stage = {
        current: "delivery", kind: "order",
        stage: "Invoices settled — waiting for remaining delivery",
        action: "View order", href: route.po(po.id), due: po.due,
      };
    } else if (RECEIVED_PO.has(po.status)) {
      stage = {
        current: "invoice", kind: "invoice",
        stage: "Delivery complete — waiting for invoice",
        action: "View order", href: route.po(po.id), due: null,
      };
    } else if (po.status === "partially_received" || po.status === "partially_accepted" ||
        challans.length || grns.length) {
      const newestGrn = grns[grns.length - 1];
      const newestChallan = challans[challans.length - 1];
      stage = {
        current: "delivery", kind: "order",
        stage: po.status.startsWith("partially")
          ? "Part delivery recorded — balance pending"
          : newestGrn?.status === "draft"
            ? "GRN draft — verify and post receipt"
            : newestChallan && !grns.length
              ? "Delivery challan received — record GRN"
              : "Delivery recorded — reconcile goods receipt",
        action: newestGrn ? "View GRN" : newestChallan ? "View challan" : "View order",
        href: newestGrn ? route.grn(newestGrn.id)
          : newestChallan ? route.challan(newestChallan.id) : route.po(po.id),
        due: po.due,
      };
    } else {
      const status: Record<string, string> = {
        draft: "PO draft — submit for approval",
        rejected: "PO returned — correct and resubmit",
        pending_approval: "Waiting for director approval",
        approved: "Order approved — waiting for delivery",
        sent: "Order sent — waiting for delivery",
      };
      stage = {
        current: "order", kind: "order",
        stage: status[po.status] ?? "Purchase order in progress",
        action: "View order", href: route.po(po.id), due: po.due,
      };
    }
    result.push({ ...makeChain("po:" + po.id, docs, stage, description, project), vendor: po.vendor });
  }

  // A GRN / challan should not silently disappear if the user's role may
  // see receipts but not the linked PO.
  for (const [kind, list] of [
    ["grn", input.grns] as const,
    ["challan", input.challans] as const,
  ]) {
    for (const item of list) {
      if (coveredDeliveries.has(item.id) || item.status === CANCELLED) continue;
      // If the PO exists but is cancelled/closed, do not resurrect its receipts.
      if (visiblePoIds.has(item.poId)) continue;
      const url = kind === "grn" ? route.grn(item.id) : route.challan(item.id);
      result.push(makeChain(kind + ":" + item.id,
        { delivery: [doc(item.number, url)] },
        { current: "delivery", kind: "order", stage: "Delivery record — review linked purchase",
          action: "View delivery", href: url, due: item.date ?? null },
        kind === "grn" ? "Goods receipt" : "Delivery challan", "Project"));
    }
  }

  for (const rfq of input.rfqs) {
    // A cancelled/closed RFQ with no issued PO must not resurrect the same
    // completed purchase as an orphan approved PR on the dashboard.
    if (rfq.prId && (rfq.status === "closed" || rfq.status === "cancelled")) {
      coveredPr.add(rfq.prId);
    }
    if (coveredRfq.has(rfq.id) || !ACTIVE_RFQ.has(rfq.status)) continue;
    const pr = rfq.prId ? prById.get(rfq.prId) : undefined;
    if (pr) coveredPr.add(pr.id);
    const docs: Docs = {
      ...(pr && { request: [doc(pr.number, route.pr(pr.id))] }),
      rfq: [doc(rfq.number, route.rfq(rfq.id))],
    };
    const stage = rfq.status === "ready_for_po"
      ? "Vendor selected — create purchase order"
      : rfq.status === "draft" ? "RFQ draft — invite vendors"
        : "Collecting vendor quotations";
    result.push(makeChain("rfq:" + rfq.id, docs, {
      current: "rfq", kind: "rfq", stage, action: "View RFQ",
      href: route.rfq(rfq.id), due: rfq.due,
    }, pr?.purpose || "RFQ & vendor quotations", rfq.project));
  }

  for (const pr of input.prs) {
    if (coveredPr.has(pr.id) || !ACTIVE_PR.has(pr.status)) continue;
    const stage: Record<string, string> = {
      draft: "Request draft — finish and submit",
      rejected: "Request returned — correct and resubmit",
      pending_approval: "Awaiting purchasing review",
      approved: "Purchase Manager received your request — prepare RFQ",
    };
    result.push(makeChain("pr:" + pr.id,
      { request: [doc(pr.number, route.pr(pr.id))] },
      {
        current: "request", kind: "request", stage: stage[pr.status] ?? "Request in progress",
        action: pr.status === "draft" ? "Finish request" : "View request",
        href: route.pr(pr.id), due: pr.due,
      }, pr.purpose || "Purchase request", pr.project));
  }

  // Bills without an accessible PO remain standalone; never invent a source
  // document link. All paid/cancelled invoices stay in the registers only.
  for (const inv of input.invoices) {
    if (coveredInvoices.has(inv.id) || !VISIBLE_INVOICE.has(inv.status) ||
      isInvoicePaid(inv)) continue;
    const linked = paymentsByInvoice.get(inv.id) ?? [];
    linked.forEach(p => coveredPayments.add(p.id));
    const pending = linked.find(p => ACTIVE_PAYMENT.has(p.status));
    const paid = inv.amountPaid > 0 || inv.advanceAdjusted > 0 ||
      linked.some(p => p.status === "recorded");
    const current: StepKey = pending || (paid && !INVOICE_NEEDS_REVIEW.has(inv.status))
      ? "payment" : "invoice";
    const focus = pending ?? linked[linked.length - 1];
    const url = current === "payment" && focus ? route.payment(focus.id) : route.invoice(inv.id);
    result.push(makeChain("invoice:" + inv.id, {
      invoice: [doc(inv.number, route.invoice(inv.id))],
      ...(linked.length && { payment: latestDocs(linked, route.payment) }),
    }, {
      current, kind: current === "payment" ? "payment" : "invoice",
      stage: pending
        ? pending.status === "approved" ? "Payment approved — record transaction"
          : "Payment scheduled — waiting for approval"
        : paid ? "Part paid — balance outstanding" : invoiceStage(inv),
      action: current === "payment" && focus ? "View payment" : "View invoice",
      href: url, due: pending?.due ?? inv.due,
    }, inv.vendor ?? "Vendor invoice", inv.project));
  }

  for (const payment of input.payments) {
    if (coveredPayments.has(payment.id) || !ACTIVE_PAYMENT.has(payment.status)) continue;
    result.push(makeChain("payment:" + payment.id,
      { payment: [doc(payment.number, route.payment(payment.id))] }, {
        current: "payment", kind: "payment",
        stage: payment.status === "approved"
          ? "Payment approved — record transaction"
          : "Payment scheduled — waiting for approval",
        action: "View payment", href: route.payment(payment.id), due: payment.due,
      }, payment.vendor ?? "Vendor payment", payment.project));
  }
  return result;
}
