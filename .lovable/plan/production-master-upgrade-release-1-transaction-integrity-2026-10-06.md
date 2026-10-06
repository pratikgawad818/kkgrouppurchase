# Production Master Upgrade — Release 1: Transaction Integrity

Your document asks for nine releases, built one at a time, with a stop for your confirmation after each. This plan covers **Release 1 only**, including your corrections.

## What changes for users

1. **Demo records are kept as they are.** No record is reclassified or deleted, and the demo flag stays. Sorting real records from test records is a separate step before go-live. Only repeated "Demo" badges are toned down, and the flag stays visible.
2. **GRN dates**: the received date can't be in the future. It defaults to today in India time.
3. **Separate quantities**: each GRN line keeps Ordered, Physically received, Accepted, Damaged and Rejected as separate figures. Physically received is never overwritten. Only the accepted quantity adds to usable stock and counts toward filling the PO. Example: 500 received and 490 accepted gives stock +490, PO accepted 490 and 10 unresolved. The PO is not fully received.
4. **What happens to damaged or rejected stock**: each unresolved quantity needs a decision. In this release you can choose:
   - **Pending Decision** (the default)
   - **Replacement Expected**
   - **Short Close** (authorised users, reason required)

   A quantity shows as "replacement pending" only if Replacement Expected was chosen. Otherwise it shows as "unresolved".
   The design leaves room to add Return to Vendor, Credit Note Expected and Accepted Under Concession later.
5. **PO statuses**:
   - Partially Accepted
   - Fully Received, once accepted equals ordered
   - Short Closed, when the rest is short-closed (accepted stays 490 and short-closed shows 10)
6. **Reversals never rewrite history**: cancelling a posted GRN needs a reason. The original GRN and its stock entries stay. New reversal entries are added and the PO quantities are restored, all as one action. You can't cancel a GRN once an invoice uses it.
7. **Invoice payable rules**:
   - An invoice is billed against accepted quantity only. Billing 500 against 490 accepted becomes an Exception: "Invoice quantity exceeds accepted quantity by 10."
   - Only an approved invoice appears in Payables.
8. **Duplicate invoices**: the same vendor bill number is blocked within the same company and vendor, even if spacing or capital letters differ.
   - It is blocked while the existing invoice is a draft, under review, an exception, approved, partly paid or paid.
   - Once the existing invoice is rejected or cancelled, you can re-enter the same number, for example as a corrected bill.
   - The message names the existing invoice, shows its status and links to it.
   - I checked: the current invoices have no duplicates, so the new rule can't fail on existing data.
9. **Tolerance snapshot**: Finance Settings stays the only current source of limits. Each match saves the quantity, rate and value limits it used, the match time, the result and the exception details. Old matches keep showing the limits that were actually used.
10. **Permanent audit trail**: the following actions record the user's name, user ID, action, document type and number, record ID, time, reason, old and new values, and the source document:
    - GRN created, edited before posting, posted, or cancelled and reversed
    - Disposition decisions and short closes
    - Invoice created, matched, approved, rejected or cancelled
    - Finance tolerance changes

    Nobody can edit or delete the audit history from the app, including Super Admin. The audit page gets filters.
11. **Ready for Delivery Challans**: received, accepted, damaged, rejected and disposition stay separate fields, and GRN lines get an empty slot for a future challan line. Release 3 can add PO ↔ Challan ↔ GRN ↔ Invoice matching without rework. The challan module itself is not built now.

## Not in this release
Commercial approval by three bosses, the Delivery Challan module, material issue, GST/CA centre, the full accounting engine and WhatsApp. These come in Releases 2–9, each after you confirm.

## Acceptance tests
Base: ordered 500, received 500, accepted 490, damaged 5, rejected 5. Expected: stock +490, PO accepted 490, unresolved 10, PO not fully received.
- **A. Replacement**: mark the 10 as Replacement Expected. A later GRN accepts 10. Total accepted is 500 and the PO becomes Fully Received.
- **B. Short close**: on a separate PO, short-close the 10 with a reason. Accepted stays 490, short-closed is 10 and the PO becomes Short Closed.

## Technical details
- Migration:
  - `goods_receipt_items`: add `replacement_pending_qty` and `returned_quantity`
  - `purchase_order_items`: add `accepted_quantity`, `short_closed_quantity`, `short_close_reason`
  - add `po_status` values `partially_accepted` and `short_closed`
  - add a validation trigger that blocks a future `receipt_date`
  - add a unique index on `(vendor_id, lower(regexp_replace(vendor_invoice_number,'\s','','g')))`
  - mark the `is_demo` columns DEPRECATED. A data update sets them to false.
- RPCs:
  - `grn_apply` and `cancel_goods_receipt` drive PO quantities from accepted quantity
  - new `short_close_po_line(_po_item, _qty, _reason)` with permission `purchase_order.short_close`
  - `run_invoice_match` reads tolerances only from `companies.finance_settings`, compares against accepted quantity minus quantity already invoiced, and stores the variance text
  - `cancel_goods_receipt` refuses when an invoice line references the GRN
- UI: remove the Demo badge from all lists; PO detail gets a pending/replacement column and a Short close dialog; GRN dialog gets a date max; invoice detail shows variance messages and the tolerance source; audit page gets filters.
- Update AGENTS.md to name the new RPC.
- Verification: signed in as Super Admin, run the acceptance scenario (500/490/5/5 → replacement 10 → invoice 500 → match PASS). Also test an over-invoice exception, a duplicate bill, GRN cancel reversal and a future-date block, at desktop and 390px widths. Report with the 10-point PASS/FAIL format.
