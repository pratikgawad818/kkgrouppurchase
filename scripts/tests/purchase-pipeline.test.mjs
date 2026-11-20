import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";

// Exercise the same pure TS module that the dashboard imports; no duplicated
// grouping implementation and no Vitest dependency excluded from this repo.
const source = readFileSync("src/lib/purchase-pipeline.ts", "utf8")
  .replace(/^export /gm, "");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const buildPurchaseChains = vm.runInNewContext(transpiled + "\nbuildPurchaseChains", {});

const pr = {
  id: "pr-1", number: "PR-2026-0004",
  purpose: "Speed Breaker - Main Road", status: "approved",
  due: "2026-11-18", project: "KK Park",
};
const rfq = {
  id: "rfq-1", number: "RFQ-2026-0005",
  status: "ready_for_po", due: "2026-11-24", prId: pr.id,
  project: "KK Park",
};
const po = {
  id: "po-1", number: "PO-2026-0003", status: "approved",
  due: "2026-11-22", prId: pr.id, rfqId: rfq.id,
  vendor: "AXNOY Industries LLP", project: "KK Park",
};
const invoice = {
  id: "invoice-1", number: "INV-2026-0002",
  status: "approved", due: "2026-12-01", poId: po.id,
  vendor: po.vendor, project: po.project,
  balanceDue: 39294, amountPaid: 0, advanceAdjusted: 0,
};
const paidInvoice = {
  ...invoice, status: "paid", balanceDue: 0, amountPaid: 39294,
};
const grn = {
  id: "grn-1", number: "GRN-2026-0001",
  status: "posted", poId: po.id,
  date: "2026-11-22",
};
const payment = {
  id: "payment-1", number: "PAY-2026-0001",
  status: "scheduled", due: "2026-12-01",
  invoiceIds: [invoice.id], vendor: po.vendor, project: po.project,
};
const empty = () => ({
  prs: [], rfqs: [], pos: [], challans: [], grns: [], invoices: [], payments: [],
});
const linked = () => ({
  ...empty(), prs: [pr], rfqs: [rfq], pos: [po],
});
const statuses = result => result[0]?.steps.map(step => step.state);
const current = result => result[0]?.steps.find(step => step.state === "current")?.key;

describe("purchase-chain dashboard projection", () => {
  it("collapses PR + RFQ + PO into one row with one count and clickable document numbers", () => {
    const rows = buildPurchaseChains(linked());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].description, "Speed Breaker - Main Road");
    assert.equal(rows[0].vendor, "AXNOY Industries LLP");
    assert.equal(rows[0].due, "2026-11-22");
    assert.deepEqual(Array.from(statuses(rows)), ["done","done","current","todo","todo","todo"]);
    assert.equal(rows[0].steps[0].documents[0].number, "PR-2026-0004");
    assert.equal(rows[0].steps[1].documents[0].href, "/procurement/rfqs/rfq-1");
    assert.equal(rows[0].steps[2].documents[0].href, "/procurement/purchase-orders/po-1");
    assert.match(rows[0].stage, /waiting for delivery/);
    assert.equal(rows[0].group, "purchasing");
  });

  it("starts from the earliest available PR and progresses to RFQ without duplicate request", () => {
    const rows = buildPurchaseChains({ ...empty(), prs: [pr], rfqs: [rfq] });
    assert.equal(rows.length, 1);
    assert.equal(current(rows), "rfq");
    assert.equal(rows[0].number, pr.number);
    assert.equal(rows[0].steps[0].state, "done");
  });

  it("moves an order into delivery when challan or GRN is present", () => {
    const challan = { id:"ch-1", number:"CH-1", status:"recorded", poId:po.id };
    const rows = buildPurchaseChains({
      ...linked(), challans:[challan], grns:[grn],
    });
    assert.equal(rows.length, 1);
    assert.equal(current(rows), "delivery");
    assert.equal(rows[0].steps[3].documents.length, 2);
    assert.deepEqual(Array.from(rows[0].steps[3].documents.map(d=>d.number)), ["CH-1","GRN-2026-0001"]);
    assert.equal(rows[0].action, "View GRN");
  });

  it("fully received but uninvoiced purchase remains visible waiting for invoice", () => {
    const rows = buildPurchaseChains({
      ...linked(), pos:[{ ...po, status:"fully_received" }], grns:[grn],
    });
    assert.equal(rows.length, 1);
    assert.equal(current(rows), "invoice");
    assert.match(rows[0].stage, /waiting for invoice/);
  });

  it("does not hide an order just because an invoice exists or one payment was recorded", () => {
    const rows = buildPurchaseChains({
      ...linked(), pos:[{ ...po, status:"fully_received" }],
      invoices:[{ ...invoice, status:"partially_paid", amountPaid:1000, balanceDue:38294 }],
      payments:[{ ...payment, status:"recorded" }],
    });
    assert.equal(rows.length, 1);
    assert.equal(current(rows), "payment");
    assert.match(rows[0].stage, /Part paid/);
    assert.equal(rows[0].steps[5].documents[0].number, payment.number);
  });

  it("does not hide a split order when only one of its invoices has been paid", () => {
    const second = { ...invoice, id:"invoice-2", number:"INV-2", balanceDue:5000 };
    const rows = buildPurchaseChains({
      ...linked(), pos:[{ ...po, status:"fully_received" }],
      invoices:[paidInvoice, second],
    });
    assert.equal(rows.length, 1);
    assert.equal(current(rows), "payment");
    assert.equal(rows[0].steps[4].documents.length, 2);
  });

  it("hides only when goods are received and every linked invoice is fully settled", () => {
    const rows = buildPurchaseChains({
      ...linked(), pos:[{ ...po, status:"fully_received" }],
      invoices:[paidInvoice],
      payments:[{ ...payment, status:"recorded" }],
    });
    assert.equal(rows.length, 0);
  });

  it("a fully paid invoice does not hide an order still waiting for material delivery", () => {
    const rows = buildPurchaseChains({
      ...linked(), invoices:[paidInvoice], pos:[po],
    });
    assert.equal(rows.length, 1);
    assert.equal(current(rows), "delivery");
  });

  it("one request split across two vendors creates one line per PO with the same PR/RFQ", () => {
    const other = { ...po, id:"po-2", number:"PO-2026-0009", vendor:"Different vendor" };
    const rows = buildPurchaseChains({ ...linked(), pos:[po, other] });
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.steps[0].documents[0].number === pr.number));
    assert.ok(rows.every(row => row.steps[1].documents[0].number === rfq.number));
    assert.notEqual(rows[0].id, rows[1].id);
  });

  it("never duplicates a payment across a linked PO chain and an orphan payment", () => {
    const rows = buildPurchaseChains({
      ...linked(), invoices:[invoice], payments:[payment],
    });
    assert.equal(rows.length, 1);
    assert.equal(current(rows), "payment");
    assert.equal(rows[0].steps[5].documents.length, 1);
  });

  it("a payment allocated across two POs does not collapse distinct orders", () => {
    const other = { ...po, id:"po-2", number:"PO-2026-0010" };
    const otherInvoice = { ...invoice, id:"invoice-2", number:"INV-2", poId:other.id };
    const sharedPayment = { ...payment, invoiceIds:[invoice.id,otherInvoice.id] };
    const rows = buildPurchaseChains({
      ...linked(), pos:[po, other],
      invoices:[invoice,otherInvoice],
      payments:[sharedPayment],
    });
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.steps[5].documents[0].number === payment.number));
  });

  it("an unlinked old vendor invoice remains a standalone finance purchase", () => {
    const rows = buildPurchaseChains({
      ...empty(), invoices:[{...invoice, id:"legacy", poId:null, number:"INV-OLD"}],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].group, "payments");
    assert.equal(rows[0].steps[4].documents[0].number, "INV-OLD");
    assert.equal(rows[0].steps[0].state, "todo");
  });

  it("standalone scheduled payments appear once even without invoice permission", () => {
    const rows = buildPurchaseChains({
      ...empty(), payments:[{ ...payment, invoiceIds:[] }],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, "View payment");
  });

  it("hides cancelled and closed orders, without resurrecting their parent PR and RFQ", () => {
    for (const status of ["cancelled", "closed"]) {
      const rows = buildPurchaseChains({ ...linked(), pos:[{...po,status}] });
      assert.equal(rows.length, 0, status);
    }
  });

  it("does not incorrectly mark hidden parent stages as completed", () => {
    const rows = buildPurchaseChains({ ...empty(), pos:[po] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].steps[0].state, "todo");
    assert.equal(rows[0].steps[1].state, "todo");
    assert.equal(rows[0].steps[2].state, "current");
  });

  it("keeps returned PO visible for corrections", () => {
    const rows = buildPurchaseChains({ ...linked(), pos:[{...po,status:"rejected"}] });
    assert.equal(rows.length, 1);
    assert.equal(current(rows), "order");
    assert.match(rows[0].stage, /correct and resubmit/);
  });

  it("does not hide a partly paid orphan invoice", () => {
    const rows = buildPurchaseChains({
      ...empty(),
      invoices:[{ ...invoice, id:"old-invoice", poId:null, status:"partially_paid", balanceDue:2200, amountPaid:500 }],
    });
    assert.equal(rows.length, 1);
    assert.equal(current(rows), "payment");
  });

  it("keeps its original purchase stable while adding multiple deliveries", () => {
    const rows = buildPurchaseChains({
      ...linked(), grns:[
        grn, { ...grn, id:"grn-2", number:"GRN-2026-0002" },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "po:" + po.id);
    assert.equal(rows[0].steps[3].documents.length, 2);
  });
});
