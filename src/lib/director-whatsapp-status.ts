/** Delivery receipts and director decisions are separate facts. */
export function directorAlertLabel(status: string, deliveryStatus?: string | null, errorCode?: string | null) {
  if (status !== "accepted") {
    const labels: Record<string, string> = {
      queued: "Queued", claimed: "Sending", rejected: "Rejected by Meta",
      unknown: "Send outcome unknown · review required", skipped: "Skipped",
    };
    return labels[status] ?? "Status unavailable";
  }
  if (deliveryStatus === "read") return "Read on WhatsApp";
  if (deliveryStatus === "delivered") return "Delivered on WhatsApp";
  if (deliveryStatus === "sent") return "Sent · awaiting delivery confirmation";
  if (deliveryStatus === "failed") return "Delivery failed" +
    (errorCode && /^\d{1,10}$/.test(errorCode) ? " · Meta code " + errorCode : "");
  return "Accepted by Meta · delivery unconfirmed";
}
