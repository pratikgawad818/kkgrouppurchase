import type { TaskGroup, WorkspaceTask } from "@/lib/workspace-tasks";

/** Normalised rows for building one dashboard line per purchase. */
export type PipePR = { id: string; number: string; purpose: string | null; status: string; due: string | null; project: string };
export type PipeRFQ = { id: string; number: string; status: string; due: string | null; prId: string | null; project: string };
export type PipePO = { id: string; number: string; status: string; due: string | null; prId: string | null; rfqId: string | null; vendor: string | null; project: string };
export type PipeDoc = { id: string; number: string; status: string; poId: string };
export type PipeInvoice = { id: string; number: string; status: string; due: string | null; poId: string | null; vendor: string | null; project: string };
export type PipePayment = { id: string; number: string; status: string; due: string | null; invoiceIds: string[]; vendor: string | null; project: string };

export type StepKey = "request" | "rfq" | "order" | "delivery" | "invoice" | "payment";
export type PipelineStep = { key: StepKey; label: string; number?: string; href?: string; state: "done" | "current" | "todo" };
export type PurchaseChain = WorkspaceTask & { steps: PipelineStep[]; stage: string };

const STEP_ORDER: StepKey[] = ["request", "rfq", "order", "delivery", "invoice", "payment"];
const STEP_LABEL: Record<StepKey, string> = {
  request: "Request",
  rfq: "RFQ",
  order: "Order",
  delivery: "Challan / GRN",
  invoice: "Invoice",
  payment: "Payment",
};
const OPEN_INVOICE = new Set(["draft", "pending_review", "exception", "approved", "partially_paid"]);
const OPEN_PAYMENT = new Set(["scheduled", "approved"]);
const OPEN_RFQ = new Set(["draft", "sent", "partially_responded", "fully_responded", "ready_for_po"]);
const OPEN_PR = new Set(["draft", "pending_approval", "approved"]);
const DEAD = new Set(["cancelled", "rejected"]);

const href = {
  request: (id: string) => `/procurement/purchase-requests/${id}`,
  rfq: (id: string) => `/procurement/rfqs/${id}`,
  order: (id: string) => `/procurement/purchase-orders/${id}`,
  challan: (id: string) => `/inventory/delivery-challans/${id}`,
  grn: (id: string) => `/inventory/goods-received/${id}`,
  invoice: (id: string) => `/finance/vendor-invoices/${id}`,
  payment: (id: string) => `/finance/payments/${id}`,
};

const invoiceStage: Record<string, string> = {
  draft: "Invoice draft — finish entry",
  pending_review: "Invoice waiting for approval",
  exception: "Invoice mismatch — director review",
  approved: "Invoice approved — waiting for payment",
  partially_paid: "Part paid — balance pending",
};

type Docs = Partial<Record<StepKey, { number: string; href: string }>>;

function steps(docs: Docs, current: StepKey): PipelineStep[] {
  const at = STEP_ORDER.indexOf(current);
  return STEP_ORDER.map((key, i) => ({
    key,
    label: STEP_LABEL[key],
    ...(docs[key] ?? {}),
    state: i < at ? "done" : i === at ? "current" : "todo",
  }));
}

function chain(
  id: string,
  current: StepKey,
  docs: Docs,
  t: { description: string; project: string; due: string | null; stage: string; action: string; href: string; kind: WorkspaceTask["kind"] },
): PurchaseChain {
  const group: TaskGroup = current === "invoice" || current === "payment" ? "payments" : "purchasing";
  const lead = docs.request ?? docs.order ?? docs.invoice ?? docs.payment ?? docs.rfq;
  return { id, group, number: lead?.number ?? "", steps: steps(docs, current), ...t };
}

export function buildPurchaseChains(input: {
  prs: PipePR[];
  rfqs: PipeRFQ[];
  pos: PipePO[];
  challans: PipeDoc[];
  grns: PipeDoc[];
  invoices: PipeInvoice[];
  payments: PipePayment[];
}): PurchaseChain[] {
  const prById = new Map(input.prs.map((r) => [r.id, r]));
  const rfqById = new Map(input.rfqs.map((r) => [r.id, r]));
  const out: PurchaseChain[] = [];
  const usedInvoices = new Set<string>();
  const usedPayments = new Set<string>();
  const coveredPr = new Set<string>();
  const coveredRfq = new Set<string>();
  const paymentsFor = (invoiceIds: Set<string>) =>
    input.payments.filter((p) => p.invoiceIds.some((i) => invoiceIds.has(i)));

  for (const po of input.pos) {
    if (po.status === "cancelled") continue;
    const rfq = po.rfqId ? rfqById.get(po.rfqId) : undefined;
    const pr = prById.get(po.prId ?? rfq?.prId ?? "");
    if (pr) coveredPr.add(pr.id);
    if (rfq) coveredRfq.add(rfq.id);
    const invoices = input.invoices.filter((i) => i.poId === po.id && i.status !== "cancelled");
    invoices.forEach((i) => usedInvoices.add(i.id));
    const pays = paymentsFor(new Set(invoices.map((i) => i.id))).filter((p) => p.status !== "cancelled");
    pays.forEach((p) => usedPayments.add(p.id));
    const grn = input.grns.filter((g) => g.poId === po.id && g.status !== "cancelled").at(-1);
    const challan = input.challans.filter((c) => c.poId === po.id && c.status !== "cancelled").at(-1);
    const openPay = pays.find((p) => OPEN_PAYMENT.has(p.status));
    const openInv = invoices.find((i) => OPEN_INVOICE.has(i.status));
    const lastInv = openInv ?? invoices.at(-1);
    const lastPay = openPay ?? pays.at(-1);
    const docs: Docs = {
      ...(pr && { request: { number: pr.number, href: href.request(pr.id) } }),
      ...(rfq && { rfq: { number: rfq.number, href: href.rfq(rfq.id) } }),
      order: { number: po.number, href: href.order(po.id) },
      ...(grn
        ? { delivery: { number: grn.number, href: href.grn(grn.id) } }
        : challan && { delivery: { number: challan.number, href: href.challan(challan.id) } }),
      ...(lastInv && { invoice: { number: lastInv.number, href: href.invoice(lastInv.id) } }),
      ...(lastPay && { payment: { number: lastPay.number, href: href.payment(lastPay.id) } }),
    };
    const base = {
      description: pr?.purpose || po.vendor || "Purchase order",
      project: po.project,
    };
    const vendor = po.vendor ? ` · ${po.vendor}` : "";
    if (openPay) {
      out.push(chain(po.id, "payment", docs, { ...base, kind: "payment", due: openPay.due, stage: openPay.status === "approved" ? "Payment approved — record it" : "Payment scheduled — waiting for approval", action: "View payment", href: href.payment(openPay.id) }));
      continue;
    }
    if (openInv) {
      out.push(chain(po.id, "invoice", docs, { ...base, kind: "invoice", due: openInv.due, stage: invoiceStage[openInv.status] ?? "Invoice in progress", action: "View invoice", href: href.invoice(openInv.id) }));
      continue;
    }
    const received = ["fully_received", "closed", "short_closed"].includes(po.status);
    if (received) {
      if (invoices.length) continue; // invoiced and nothing open: fully settled
      out.push(chain(po.id, "invoice", docs, { ...base, kind: "order", due: null, stage: "Material received — waiting for invoice", action: "View order", href: href.order(po.id) }));
      continue;
    }
    if (["partially_received", "partially_accepted"].includes(po.status) || grn || challan) {
      out.push(chain(po.id, "delivery", docs, { ...base, kind: "order", due: po.due, stage: po.status.startsWith("partially") ? `Part received${vendor} — balance due` : `Delivery arrived${vendor} — record GRN`, action: "View order", href: href.order(po.id) }));
      continue;
    }
    const orderStage: Record<string, string> = {
      draft: "Order draft — submit for approval",
      pending_approval: "Waiting for director approval",
      rejected: "Order rejected",
      approved: `Order approved${vendor} — waiting for delivery`,
      sent: `Order sent${vendor} — waiting for delivery`,
    };
    out.push(chain(po.id, "order", docs, { ...base, kind: "order", due: po.due, stage: orderStage[po.status] ?? "Order in progress", action: "View order", href: href.order(po.id) }));
  }

  for (const rfq of input.rfqs) {
    if (coveredRfq.has(rfq.id) || !OPEN_RFQ.has(rfq.status)) continue;
    const pr = rfq.prId ? prById.get(rfq.prId) : undefined;
    if (pr) coveredPr.add(pr.id);
    const docs: Docs = {
      ...(pr && { request: { number: pr.number, href: href.request(pr.id) } }),
      rfq: { number: rfq.number, href: href.rfq(rfq.id) },
    };
    out.push(chain(rfq.id, "rfq", docs, {
      kind: "rfq",
      description: pr?.purpose || "RFQ & quotations",
      project: rfq.project,
      due: rfq.due,
      stage: rfq.status === "ready_for_po" ? "Vendor selected — create purchase order" : rfq.status === "draft" ? "RFQ draft — send to vendors" : "Collecting vendor quotations",
      action: "View RFQ",
      href: href.rfq(rfq.id),
    }));
  }

  const prHasLiveChild = (id: string) =>
    input.rfqs.some((r) => r.prId === id && !DEAD.has(r.status)) ||
    input.pos.some((p) => p.prId === id && !DEAD.has(p.status));
  for (const pr of input.prs) {
    if (coveredPr.has(pr.id) || !OPEN_PR.has(pr.status) || prHasLiveChild(pr.id)) continue;
    out.push(chain(pr.id, "request", { request: { number: pr.number, href: href.request(pr.id) } }, {
      kind: "request",
      description: pr.purpose || "Purchase request",
      project: pr.project,
      due: pr.due,
      stage: pr.status === "draft" ? "Request draft — finish and submit" : pr.status === "pending_approval" ? "Waiting for approval" : "Approved — send RFQ to vendors",
      action: pr.status === "draft" ? "Finish request" : "View request",
      href: href.request(pr.id),
    }));
  }

  for (const inv of input.invoices) {
    if (usedInvoices.has(inv.id) || !OPEN_INVOICE.has(inv.status)) continue;
    const pays = paymentsFor(new Set([inv.id])).filter((p) => p.status !== "cancelled");
    pays.forEach((p) => usedPayments.add(p.id));
    const openPay = pays.find((p) => OPEN_PAYMENT.has(p.status));
    const docs: Docs = {
      invoice: { number: inv.number, href: href.invoice(inv.id) },
      ...(openPay && { payment: { number: openPay.number, href: href.payment(openPay.id) } }),
    };
    out.push(chain(inv.id, openPay ? "payment" : "invoice", docs, {
      kind: openPay ? "payment" : "invoice",
      description: inv.vendor ?? "Vendor invoice",
      project: inv.project,
      due: openPay?.due ?? inv.due,
      stage: openPay ? "Payment in progress" : (invoiceStage[inv.status] ?? "Invoice in progress"),
      action: openPay ? "View payment" : "View invoice",
      href: openPay ? href.payment(openPay.id) : href.invoice(inv.id),
    }));
  }

  for (const pay of input.payments) {
    if (usedPayments.has(pay.id) || !OPEN_PAYMENT.has(pay.status)) continue;
    out.push(chain(pay.id, "payment", { payment: { number: pay.number, href: href.payment(pay.id) } }, {
      kind: "payment",
      description: pay.vendor ?? "Vendor payment",
      project: pay.project,
      due: pay.due,
      stage: pay.status === "approved" ? "Payment approved — record it" : "Payment scheduled — waiting for approval",
      action: "View payment",
      href: href.payment(pay.id),
    }));
  }
  return out;
}
