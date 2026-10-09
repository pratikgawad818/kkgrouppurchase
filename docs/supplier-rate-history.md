# KK GROUP ERP — Supplier Rate History (awarded purchase orders)

**Route:** `/procurement/supplier-rate-history`, available to staff with `purchase_order.view` through existing role permissions and project/company RLS.

## Why builders need it

Procurement teams need a quick benchmark before sending fresh RFQs for cement, sand, steel, plumbing fittings and similar repeat purchases. This report uses the actual *awarded purchase-order line base rates*, not unsanctioned draft quotations or cash-payment values.

Each material comparison groups by the exact **material ID and unit-of-measure ID**. It does not invent unit conversions (e.g., pieces ↔ boxes, cubic metres ↔ tonnes), and doesn't combine similarly named materials with different specifications.

## Metrics and exclusions

- Source: `purchase_orders` + `purchase_order_items` + `vendors` + `projects`.
- Included PO statuses: approved, sent, partially received, partially accepted, fully received, short closed, closed.
- Excluded statuses: draft, pending approval, rejected, cancelled.
- Excluded price lines: nonpositive rate, nonpositive ordered quantity, invalid material/unit.
- **Latest recorded supplier rate**: newest PO date for that exact vendor + material + unit. It is **not a current quote**. Display the source PO document for verification.
- **Volume-weighted historical base rate**: sum(`unit_rate × ordered_quantity`) / sum(`ordered_quantity`) for eligible line observations. Ordered quantities are not stock receipts, material consumption, actual expenditure, or cash payments.
- Min/max: **observed rates only** for the selected period; never assert this is a new offer. Differences in credit terms, transport, specification and order quantities can make apparent lower rates unattractive.
- PO line `rate` is shown as recorded, **before any `discount_amount`, tax or PO-level freight/other charges**. Any historical line discount is flagged, not silently applied.
- All supplier rate comparisons are historical. Users should issue a new RFQ to verify current prices.
- API pagination: batches of 500 up to 3,000 awarded POs, with an incomplete dataset warning at cap. The report defaults to the last 12 months of accessible data, with 90-day, 24-month and all-history options. No source data are modified.

## Acceptance checks

Run `node --test scripts/tests/supplier-rate-history.test.mjs`, strict TypeScript and production bundle checks. Unit tests cover award statuses, positive pricing, material+unit segregation, weighted averages, latest rate and discount flags.

Manual acceptance still required for the authenticated phone/desktop UI and vendor-based RLS visibility. Never use this read-only analysis page to bypass quotation-selection approvals.
