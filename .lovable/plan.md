# Production Master Upgrade — Release 1: Transaction Integrity

Your document asks for nine releases, built one at a time, with a stop for your confirmation after each. This plan covers **Release 1 only**. It also finishes the "Demo" label removal we started earlier.

## What changes for users

1. **"Demo" labels removed**: all existing projects, vendors, materials, stores and categories are treated as real records. No data is deleted.
2. **GRN dates**: the received date can't be set in the future, and it defaults to today in India time.
3. **Damaged and rejected stock**: these no longer count as received against the PO. In the cement example (500 ordered, 490 accepted), the PO shows "490 accepted · 10 replacement pending" instead of "fully received".
4. **Replacements and short close**: a later GRN for the replacement 10 completes the PO. Or an authorised user can **short-close** the remaining quantity, with a reason. The PO statuses become Partially Accepted / Fully Received / Short Closed.
5. **Reversals**: cancelling a posted GRN puts the PO pending quantities back and adds reversal entries to the stock ledger. You can't cancel a GRN once an invoice uses it.
6. **Invoice payable rules**:
   - An invoice is billed against accepted quantity only. An invoice for 500 against 490 accepted becomes an Exception with the message "Invoice quantity exceeds accepted quantity by 10."
   - Only an approved invoice appears in Payables.
7. **Duplicate invoices**: the same vendor bill number is blocked even if the spacing or capital letters differ. You get a clear message instead of a database error.
8. **Tolerances**: matching always reads the tolerance limits from Company Settings → Finance, and the invoice shows which limits it used.
9. **Audit**: every GRN post or cancel, short close, and invoice approval records who did it, when, the reason, and the before and after values. The audit page gets filters.

## Not in this release
Commercial approval by three bosses, delivery challans, material issue, GST/CA centre, the full accounting engine and WhatsApp. These come in Releases 2–9, each after you confirm.

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
