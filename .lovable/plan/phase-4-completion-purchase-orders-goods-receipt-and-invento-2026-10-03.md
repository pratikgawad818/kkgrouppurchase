# Phase 4 completion: Purchase Orders, Goods Receipt and Inventory

Most of Phase 4 already works: creating POs from vendor selection (split by vendor), PO-YYYY-0001 numbering, PO approval with no self-approval, partial goods receipts with an over-receipt block, weighted-average stock by store, the stock ledger and stock transfers. This plan fills the gaps between the current build and the spec. Nothing already built gets rebuilt.

## What changes for users

1. **Goods receipts (GRN)**
   - Record **rejected** quantity as well as damaged. Accepted = received − damaged − rejected, and only the accepted quantity goes into stock.
   - GRN status: **Draft → Posted → Cancelled**. A draft doesn't touch stock. Posting adds stock. Cancelling a posted GRN creates reversal entries in the stock ledger, needs a reason, and never deletes records.
   - Receiving more than the pending quantity shows: "Cannot receive 250. Only 200 units remain pending."
   - The GRN detail page shows the PR, RFQ and building, plus the stock entries that GRN created.
   - The GRN list gets filters for project, building, store, vendor, financial year and dates, plus an accepted value column.

2. **Purchase orders**
   - The list gets received value, pending value, building and RFQ columns. Filters: vendor, project, building, financial year, dates. Search covers material and RFQ number.
   - An approved PO can be cancelled (reason required) as long as no goods have been received.
   - **Professional print/PDF**: company name, address, GSTIN, PAN, phone and email come from Company Settings, never hard-coded. It also shows vendor details, CGST/SGST/IGST split, terms and an authorised signatory block. "Download PDF" opens the browser's save-as-PDF.
   - The history timeline also lists GRN receipts against the PO.

3. **Inventory**
   - **Stock adjustment**: enter the counted physical quantity and a reason. The system works out the difference and posts it to the ledger. Only users with the new adjust permission can do this.
   - **Opening stock** entry, for authorised users only.
   - Stock movements page: filters for material, store, project, type and dates, plus building and user columns.

4. **Dashboard** (real records only)
   - Purchase Orders cards: Pending approval, Approved, Sent, Partially received, Fully received, Pending receipt value.
   - Goods Received: this month, this financial year, recent GRNs.
   - Inventory: total stock value, material count, low-stock and out-of-stock counts, recent transfers. Cards link to their pages.

5. **Not built in this phase**: vendor invoices, payables, payments, accounting entries. Every GRN line keeps its PO line, rate and quantity references so 3-way matching can be added later.

## Technical details

- Migration:
  - add `rejected_quantity` to `goods_receipt_items`
  - add `status` (`draft/posted/cancelled`), `building_id`, `rfq_id`, `purchase_request_id`, `cancelled_by/at/reason` to `goods_receipt_notes`
  - add `building_id` and `adjustment_id` to `inventory_transactions`
  - new `stock_adjustments` and `stock_adjustment_items` tables (ADJ-YYYY-0001), with grants and RLS
  - new permissions: `purchase_order.edit/submit/reject`, `grn.edit_draft/post/cancel`, `inventory.receive/adjust`, mapped to roles. Store managers adjust; directors adjust and approve.
- RPCs:
  - `create_goods_receipt` gains `_post boolean`, returning the exact "Only N remain" message
  - new `post_goods_receipt`, `cancel_goods_receipt` (posts reversing ledger rows and restores PO received quantities), `create_stock_adjustment`, `post_opening_stock`
  - `po_transition` allows approved → cancelled when nothing has been received
- Ledger stays append-only. Corrections only through reversal rows. All amounts stay in database numeric.
- UI files touched: PO list/detail (print layout using company settings), GRN list/detail, receive dialog, stock page (Adjust / Opening stock dialogs), stock movements, dashboard.
- Update the AGENTS.md rule to name the new RPCs.
