/** Gross invoice totals for the caller's currently visible register rows.
 * All arithmetic is performed in integer paise to prevent float drift.
 * "Approved/Paid" includes partial and fully paid invoices by original bill
 * value, NOT cash received or outstanding balance.
 */
export type InvoiceForSummary = {
  status: string;
  grand_total: number | string | null;
};
export type InvoiceBucket = { count: number; paise: number; total: number };
export type InvoiceStatusSummary = {
  unapproved: InvoiceBucket;
  approved: InvoiceBucket;
  combined: InvoiceBucket;
  excluded: InvoiceBucket;
};
const unapprovedStatuses = new Set(["draft", "pending_review", "exception"]);
const approvedStatuses = new Set(["approved", "partially_paid", "paid"]);

export function summarizeInvoiceStatuses(rows: readonly InvoiceForSummary[]): InvoiceStatusSummary {
  const count = { unapproved: 0, approved: 0, excluded: 0 };
  const paise = { unapproved: 0, approved: 0, excluded: 0 };
  for (const row of rows) {
    const amount = Number(row.grand_total ?? 0);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
      throw new Error("Cannot calculate invoice totals: invalid invoice amount");
    }
    const group = unapprovedStatuses.has(row.status) ? "unapproved"
      : approvedStatuses.has(row.status) ? "approved" : "excluded";
    count[group]++;
    paise[group] += Math.round(amount * 100);
    if (!Number.isSafeInteger(paise[group])) throw new Error("Invoice total exceeds precision limit");
  }
  const bucket = (group: keyof typeof count): InvoiceBucket => ({
    count: count[group], paise: paise[group], total: paise[group] / 100,
  });
  const combinedPaise = paise.unapproved + paise.approved;
  if (!Number.isSafeInteger(combinedPaise)) throw new Error("Invoice total exceeds precision limit");
  return {
    unapproved: bucket("unapproved"),
    approved: bucket("approved"),
    combined: {
      count: count.unapproved + count.approved,
      paise: combinedPaise,
      total: combinedPaise / 100,
    },
    excluded: bucket("excluded"),
  };
}
