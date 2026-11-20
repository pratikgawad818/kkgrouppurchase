import { describe, expect, it } from "vitest";
import { buildPurchaseChains } from "./purchase-pipeline";

const pr = { id: "pr1", number: "PR-2026-0004", purpose: "Speed Breaker - Main Road", status: "approved", due: "2026-11-18", project: "KK Park" };
const rfq = { id: "rfq1", number: "RFQ-2026-0005", status: "ready_for_po", due: "2026-11-26", prId: "pr1", project: "KK Park" };
const po = { id: "po1", number: "PO-2026-0003", status: "approved", due: "2026-11-22", prId: "pr1", rfqId: "rfq1", vendor: "AXNOY Industries LLP", project: "KK Park" };
const empty = { prs: [], rfqs: [], pos: [], challans: [], grns: [], invoices: [], payments: [] };

describe("buildPurchaseChains", () => {
  it("shows PR, RFQ and PO for the same purchase as one line", () => {
    const rows = buildPurchaseChains({ ...empty, prs: [pr], rfqs: [rfq], pos: [po] });
    expect(rows).toHaveLength(1);
    expect(rows[0].steps.map((s) => s.state)).toEqual(["done", "done", "current", "todo", "todo", "todo"]);
    expect(rows[0].steps[0].number).toBe("PR-2026-0004");
  });

  it("moves the same line to delivery when a GRN is recorded", () => {
    const rows = buildPurchaseChains({ ...empty, prs: [pr], rfqs: [rfq], pos: [{ ...po, status: "partially_received" }], grns: [{ id: "g1", number: "GRN-1", status: "posted", poId: "po1" }] });
    expect(rows).toHaveLength(1);
    expect(rows[0].steps.find((s) => s.state === "current")?.key).toBe("delivery");
  });

  it("hides a purchase once it is received and fully paid", () => {
    const rows = buildPurchaseChains({ ...empty, prs: [pr], rfqs: [rfq], pos: [{ ...po, status: "fully_received" }], invoices: [{ id: "i1", number: "INV-1", status: "paid", due: null, poId: "po1", vendor: null, project: "KK Park" }] });
    expect(rows).toHaveLength(0);
  });

  it("gives one line per order when one request has two orders", () => {
    const rows = buildPurchaseChains({ ...empty, prs: [pr], rfqs: [rfq], pos: [po, { ...po, id: "po2", number: "PO-2026-0009" }] });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.steps[0].number === "PR-2026-0004")).toBe(true);
  });

  it("keeps an old bill without an order as its own line", () => {
    const rows = buildPurchaseChains({ ...empty, invoices: [{ id: "i1", number: "OB-1", status: "approved", due: null, poId: null, vendor: "JCB", project: "KK Park" }] });
    expect(rows).toHaveLength(1);
    expect(rows[0].group).toBe("payments");
  });
});
