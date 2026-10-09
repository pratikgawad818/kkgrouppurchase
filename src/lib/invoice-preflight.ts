/**
 * Client-side preflight for editing a vendor bill against posted GRN items.
 * These checks improve UX; the authoritative financial/3-way-match controls
 * remain on the server. Advisories are NOT an approval or match result.
 */
export type InvoicePreflightLine = {
  grn_item_id: string;
  material: string;
  include: boolean;
  quantity: string;
  available: number;
  rate: string;
  po_rate: number;
  tax_rate_percent: string;
  po_tax: number;
};

export type InvoicePreflightHeader = {
  vendor_invoice_number: string;
  vendor_invoice_date: string;
  due_date: string;
  freight: string;
  other_charges: string;
  tds_rate: string;
};

export type InvoicePreflightResult = {
  errors: string[];
  advisories: string[];
  lineCount: number;
  hasVariances: boolean;
};

function precisionWithin(value: string, places: number): boolean {
  const parsed = value.trim();
  const decimal = parsed.match(/^(?:\d+)(?:\.(\d+))?$/);
  return !!decimal && (decimal[1]?.length ?? 0) <= places;
}

function nonnegativeAmount(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && precisionWithin(value, 2);
}

export function inspectVendorInvoice(
  lines: InvoicePreflightLine[],
  header: InvoicePreflightHeader,
): InvoicePreflightResult {
  const errors: string[] = [];
  const advisories: string[] = [];
  const selected = lines.filter(l => l.include);
  const seen = new Set<string>();
  let subtotal = 0;
  let taxAmount = 0;
  let changedRates = 0;
  let changedTaxes = 0;
  let zeroRated = 0;

  if (!header.vendor_invoice_number.trim()) errors.push("Enter the supplier's bill number.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(header.vendor_invoice_date)) {
    errors.push("Enter a valid supplier bill date.");
  }
  if (header.due_date && /^\d{4}-\d{2}-\d{2}$/.test(header.due_date) &&
      header.due_date < header.vendor_invoice_date) {
    advisories.push("Due date is before the bill date. Confirm the supplier's terms.");
  }
  if (!selected.length) errors.push("Select at least one accepted GRN line.");

  for (const line of selected) {
    const label = line.material || "GRN item";
    if (!line.grn_item_id) {
      errors.push(`A selected ${label} line has no GRN item ID.`);
    } else if (seen.has(line.grn_item_id)) {
      errors.push(`The same GRN line was selected more than once (${label}).`);
    } else {
      seen.add(line.grn_item_id);
    }

    const qty = Number(line.quantity);
    if (!line.quantity.trim() || !Number.isFinite(qty) || qty <= 0 ||
        !precisionWithin(line.quantity, 3)) {
      errors.push(`Enter a positive quantity (up to 3 decimals) for ${label}.`);
      continue;
    }
    if (!Number.isFinite(line.available) || line.available < 0) {
      errors.push(`Available accepted quantity for ${label} is unavailable. Refresh the GRN check.`);
    } else if (qty > line.available + 0.000001) {
      errors.push(`Cannot invoice ${qty} of ${label}: only ${line.available} accepted units remain uninvoiced.`);
    }

    const rate = Number(line.rate);
    const tax = Number(line.tax_rate_percent);
    if (!nonnegativeAmount(line.rate)) {
      errors.push(`Enter a non-negative unit rate with up to 2 decimals for ${label}.`);
    } else {
      subtotal += Math.round(qty * rate * 100) / 100;
      if (rate === 0) zeroRated++;
      if (Number.isFinite(line.po_rate) && Math.abs(rate - line.po_rate) > 0.009) changedRates++;
    }
    if (!nonnegativeAmount(line.tax_rate_percent) || tax > 100) {
      errors.push(`Enter a GST percentage between 0 and 100 for ${label}.`);
    } else {
      if (Number.isFinite(rate)) taxAmount += Math.round(qty * rate * tax) / 10000;
      if (Number.isFinite(line.po_tax) && Math.abs(tax - line.po_tax) > 0.009) changedTaxes++;
    }
  }

  for (const [label, value] of [["Freight", header.freight], ["Other charges", header.other_charges]] as const) {
    if (!nonnegativeAmount(value)) errors.push(`${label} must be a non-negative amount with up to 2 decimals.`);
  }
  const tdsRate = Number(header.tds_rate);
  if (!nonnegativeAmount(header.tds_rate) || tdsRate > 100) {
    errors.push("TDS percentage must be between 0 and 100.");
  }
  if (!errors.length) {
    const extra = Number(header.freight) + Number(header.other_charges);
    const gross = subtotal + taxAmount + extra;
    const tds = (subtotal + extra) * tdsRate / 100;
    if (gross - tds < -0.01) errors.push("TDS exceeds the calculated invoice amount.");
  }

  if (changedRates) advisories.push(`${changedRates} selected line(s) have supplier rates different from the PO.`);
  if (changedTaxes) advisories.push(`${changedTaxes} selected line(s) have GST percentages different from the PO.`);
  if (zeroRated) advisories.push(`${zeroRated} selected line(s) have a zero supplier rate. Confirm this is intentional.`);

  return {
    errors,
    advisories,
    lineCount: selected.length,
    hasVariances: changedRates > 0 || changedTaxes > 0,
  };
}
