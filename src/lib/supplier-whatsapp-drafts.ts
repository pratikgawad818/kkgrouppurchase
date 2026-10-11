/**
 * Supplier-facing drafts only. This module NEVER calls the Cloud API.
 *
 * Prepare concise operational text from the currently loaded, RLS-scoped
 * ERP record. WhatsApp click-to-chat pre-fills a message but does not send it,
 * create an audit trail or change RFQ/PO statuses.
 */
import { whatsappDraftUrl } from "./approval-notifications.ts";

type MaterialLine = { name: string; quantity: number; unit?: string | null };

export type RfqDraftInput = {
  number: string;
  project: string;
  responseDue: string | null;
  requiredBy: string | null;
  materials: readonly MaterialLine[];
};

export type PoDraftInput = {
  number: string;
  project: string;
  location: string | null;
  deliveryDate: string | null;
  materials: readonly MaterialLine[];
};

const shortText = (text: string | null | undefined, limit = 90) =>
  (text ?? "").trim().slice(0, limit).replace(/[\r\n\t]+/g, " ") || "Not specified";
const date = (value: string | null) => value ? shortText(value.slice(0, 10)) : "To be confirmed";

export function materialSummary(lines: readonly MaterialLine[]): string {
  if (!lines.length) return "Material specifications: Please refer to the RFQ / PO document.";
  const shown = lines.slice(0, 8).map((line, index) => {
    const amount = Number(line.quantity);
    const qty = Number.isFinite(amount) && amount > 0 ? String(amount) : "confirm quantity";
    return (index + 1) + ". " + shortText(line.name, 75) + " - " + qty +
      (line.unit ? " " + shortText(line.unit, 20) : "");
  });
  if (lines.length > 8) shown.push("+" + (lines.length - 8) + " further item(s); refer to the source document.");
  return shown.join("\n");
}

export function rfqSupplierDraft(input: RfqDraftInput, reminder = false): string {
  const lines = [
    "*KK GROUP | Purchase Department*",
    "",
    reminder ? "*Quotation follow-up*" : "*Request for Quotation (RFQ)*",
    "RFQ: " + shortText(input.number, 50),
    "Project: " + shortText(input.project),
    "Quotation due: " + date(input.responseDue),
    "Required delivery: " + date(input.requiredBy),
  ];
  if (!reminder) {
    lines.push("", "*Required materials*", materialSummary(input.materials));
  }
  lines.push("",
    reminder
      ? "Kindly share your pending quotation or update us on its expected submission."
      : "Please confirm availability and quote rates, applicable GST, freight, lead time, payment terms and quotation validity.",
    "",
    "This message is an enquiry, not a confirmed purchase order.",
    "Regards,",
    "KK GROUP Purchase Department");
  return lines.join("\n");
}

export function purchaseOrderSupplierDraft(input: PoDraftInput): string {
  return [
    "*KK GROUP | Purchase Department*", "",
    "*Approved Purchase Order - Supplier Confirmation*",
    "PO: " + shortText(input.number, 50),
    "Project: " + shortText(input.project),
    "Delivery site: " + shortText(input.location),
    "Expected delivery: " + date(input.deliveryDate),
    "", "*Ordered materials*", materialSummary(input.materials),
    "",
    "Please review the official PO document separately and confirm order acceptance, availability and dispatch timeline.",
    "This WhatsApp message does not replace the approved purchase order PDF.",
    "",
    "Regards,",
    "KK GROUP Purchase Department",
  ].join("\n");
}

export function deliveryFollowupSupplierDraft(input: PoDraftInput): string {
  return [
    "*KK GROUP | Purchase Department*", "",
    "*Material Delivery Follow-up*",
    "PO: " + shortText(input.number, 50),
    "Project: " + shortText(input.project),
    "Delivery site: " + shortText(input.location),
    "Expected delivery: " + date(input.deliveryDate),
    "",
    "Please confirm dispatch status, estimated delivery date/time, and vehicle / challan details if dispatched.",
    "If there is a delay, kindly inform us so site arrangements can be updated.",
    "",
    "Regards,",
    "KK GROUP Purchase Department",
  ].join("\n");
}

export function supplierChatDraftUrl(mobile: string | null | undefined, message: string): string | null {
  if (!message.trim() || message.length > 3200 || !mobile) return null;
  return whatsappDraftUrl(mobile, message);
}
