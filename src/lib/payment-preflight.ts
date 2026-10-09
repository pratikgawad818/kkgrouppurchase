/**
 * Conservative, client-only validation of scheduled vendor payments.
 *
 * Always run schedule_vendor_payment on the server for the authoritative
 * reservation check: other staff may schedule payments concurrently.
 */
export type PayableInvoice = {
  id: string;
  invoice_number: string;
  payable: number;
};

export type ScheduledAllocation = {
  invoice_id: string;
  amount: number;
};

export type PaymentPreflight = {
  allocations: ScheduledAllocation[];
  total: number;
  errors: string[];
};

/** Strictly accept rupees/paise; never silently round untrusted amounts. */
function toPaise(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const rupees = Number(trimmed);
  const paise = Math.round(rupees * 100);
  if (!Number.isFinite(rupees) || !Number.isSafeInteger(paise) || paise < 0) return null;
  return paise;
}

export function availableAfterScheduled(
  balanceDue: number,
  pendingApprovals: number,
): number | null {
  if (!Number.isFinite(balanceDue) || !Number.isFinite(pendingApprovals) ||
      balanceDue < 0 || pendingApprovals < 0) return null;
  return Math.max(0, Math.round((balanceDue - pendingApprovals) * 100) / 100);
}

/**
 * Validate all typed amounts against the exact set of approved invoices
 * returned by the latest complete, successful vendor-specific availability
 * lookup. Unknown invoice IDs are rejected, not silently omitted.
 */
export function inspectPaymentSchedule(
  entered: Record<string, string>,
  invoices: PayableInvoice[],
  availabilityComplete: boolean,
): PaymentPreflight {
  const errors: string[] = [];
  const allocations: ScheduledAllocation[] = [];
  let totalPaise = 0;

  if (!availabilityComplete) {
    return { allocations: [], total: 0, errors: ["Pending payments could not be verified. Refresh before scheduling."] };
  }

  const byId = new Map(invoices.map(invoice => [invoice.id, invoice]));
  for (const [invoiceId, typed] of Object.entries(entered)) {
    if (!typed.trim()) continue;
    const invoice = byId.get(invoiceId);
    if (!invoice) {
      errors.push("A selected invoice is no longer available. Refresh the payment list.");
      continue;
    }
    const paise = toPaise(typed);
    if (paise === null) {
      errors.push(`Enter a valid non-negative amount (up to 2 decimal places) for ${invoice.invoice_number}.`);
      continue;
    }
    if (paise === 0) continue;

    if (!Number.isFinite(invoice.payable) || invoice.payable < 0) {
      errors.push(`The unpaid balance for ${invoice.invoice_number} is unavailable.`);
      continue;
    }
    const availablePaise = Math.max(0, Math.round(invoice.payable * 100));
    if (paise > availablePaise) {
      errors.push(`${invoice.invoice_number}: only ₹${(availablePaise / 100).toFixed(2)} is available after other scheduled payments.`);
      continue;
    }

    totalPaise += paise;
    if (!Number.isSafeInteger(totalPaise)) {
      errors.push("Scheduled payment total exceeds the supported numeric range.");
      break;
    }
    allocations.push({ invoice_id: invoiceId, amount: paise / 100 });
  }

  if (allocations.length === 0 && errors.length === 0) {
    errors.push("Enter a positive amount for at least one approved invoice.");
  }

  return { allocations, total: totalPaise / 100, errors };
}
