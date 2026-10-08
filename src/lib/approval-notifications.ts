/**
 * WhatsApp launch links are convenience links only. Approval requires an
 * authenticated director session and the database transition RPC.
 * Never put approval tokens, vendor bank details, or credentials in messages.
 */
export type ApprovalKind = "purchase_order" | "vendor_payment";

export type ApprovalNotice = {
  kind: ApprovalKind;
  id: string;
  number: string;
  vendor: string;
  project: string;
  amount: number;
};

export function whatsappPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = raw.trim().replace(/[\s()-]/g, "");
  // Common domestic Indian entry styles are supported for staff profiles.
  if (/^[6-9][0-9]{9}$/.test(compact)) return "91" + compact;
  if (/^0[6-9][0-9]{9}$/.test(compact)) return "91" + compact.slice(1);
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;
  // A 10-digit domestic number must be valid for India; otherwise require
  // a full international number to avoid messaging the wrong recipient.
  if (digits.length === 10 && !compact.startsWith("+")) return null;
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  return digits;
}

export function approvalDeepLink(origin: string, kind: ApprovalKind, id: string) {
  const url = new URL("/approvals", origin);
  url.searchParams.set("kind", kind);
  url.searchParams.set("id", id);
  return url.toString();
}

export function approvalMessage(notice: ApprovalNotice, origin: string) {
  const type = notice.kind === "purchase_order" ? "Purchase Order" : "Vendor Payment";
  const link = approvalDeepLink(origin, notice.kind, notice.id);
  return [
    "KK GROUP ERP | Director Approval Required",
    "",
    type + ": " + notice.number,
    "Project: " + notice.project,
    "Vendor: " + notice.vendor,
    "Amount: " + new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(notice.amount),
    "",
    notice.kind === "purchase_order"
      ? "Open to review and approve/reject securely:"
      : "Open to review and approve securely (contact Accounts to decline):",
    link,
    "",
    "Sign in with your own Director account. Forwarding this link does NOT grant approval authority.",
  ].join("\n");
}

export function whatsappDraftUrl(phone: string, message: string) {
  const destination = whatsappPhone(phone);
  return destination ? "https://wa.me/" + destination + "?text=" + encodeURIComponent(message) : null;
}
