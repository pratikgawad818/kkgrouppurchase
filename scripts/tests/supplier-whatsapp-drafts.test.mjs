import test from "node:test";
import assert from "node:assert/strict";
import {
  materialSummary, rfqSupplierDraft, purchaseOrderSupplierDraft,
  deliveryFollowupSupplierDraft, supplierChatDraftUrl,
} from "../../src/lib/supplier-whatsapp-drafts.ts";

const rfq = { number: "RFQ-2026-0003", project: "Green Heights", responseDue: "2026-10-16",
  requiredBy: "2026-10-22",
  materials: [{ name: "TMT Steel 12mm", quantity: 5, unit: "MT" },
    { name: "Cement", quantity: 30, unit: "bags" }] };
const po = { number: "PO-2026-008", project: "Green Heights",
  location: "North site", deliveryDate: "2026-10-24", materials: rfq.materials };

test("RFQ messaging includes procurement details, excludes internal target rates, states enquiry only", () => {
  const msg = rfqSupplierDraft(rfq);
  assert.match(msg, /RFQ-2026-0003/);
  assert.match(msg, /TMT Steel 12mm - 5 MT/);
  assert.match(msg, /Cement - 30 bags/);
  assert.match(msg, /GST/);
  assert.match(msg, /not a confirmed purchase order/);
  assert.doesNotMatch(msg, /target rate|access token|approved PO/i);
});

test("RFQ follow-up does not claim an order was issued", () => {
  const msg = rfqSupplierDraft(rfq, true);
  assert.match(msg, /Quotation follow-up/);
  assert.match(msg, /expected submission/);
  assert.doesNotMatch(msg, /Ordered materials|purchase order approved/i);
});

test("purchase-order draft is explicitly an approved PO notification, not a substitute for PDF", () => {
  const msg = purchaseOrderSupplierDraft(po);
  assert.match(msg, /Approved Purchase Order/);
  assert.match(msg, /PO-2026-008/);
  assert.match(msg, /official PO document separately/);
  assert.match(msg, /does not replace the approved purchase order PDF/);
});

test("delivery reminder avoids claims of dispatch or payment success", () => {
  const msg = deliveryFollowupSupplierDraft({ ...po, deliveryDate: null });
  assert.match(msg, /Material Delivery Follow-up/);
  assert.match(msg, /To be confirmed/);
  assert.match(msg, /Please confirm dispatch status/);
  assert.doesNotMatch(msg, /already dispatched|Payment completed/);
});

test("only valid supplier phone generates encoded WhatsApp draft link", () => {
  const msg = rfqSupplierDraft(rfq);
  const link = supplierChatDraftUrl("9876543210", msg);
  assert.ok(link?.startsWith("https://wa.me/919876543210?text="));
  const u = new URL(link);
  assert.equal(u.searchParams.get("text"), msg);
  assert.equal(supplierChatDraftUrl("", msg), null);
  assert.equal(supplierChatDraftUrl("1234", msg), null);
  assert.equal(supplierChatDraftUrl("9876543210", ""), null);
  assert.equal(supplierChatDraftUrl("9876543210", "x".repeat(3201)), null);
});

test("large RFQ never overflows with dozens of material details", () => {
  const materials = Array.from({ length: 45 }, (_, index) =>
    ({ name: "Materials " + index, quantity: index + 1, unit: "Nos" }));
  const msg = rfqSupplierDraft({ ...rfq, materials });
  assert.match(msg, /37 further item/);
  assert.doesNotMatch(msg, /Materials 44/);
  assert.ok(msg.length < 3200);
  assert.equal(materialSummary([]), "Material specifications: Please refer to the RFQ / PO document.");
});
