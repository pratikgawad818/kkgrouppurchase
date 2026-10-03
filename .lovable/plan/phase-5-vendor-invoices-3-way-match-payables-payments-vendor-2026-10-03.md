# Phase 5 — Vendor Invoices, 3-Way Match, Payables, Payments, Vendor Ledger

Flow: PO (commitment) → GRN (physical receipt) → Vendor Invoice (payable) → Payment (cash movement) → Vendor Ledger. No CRM, no customer collections, no P&L/Balance Sheet, no GST/TDS filing, no OCR, no purchase returns.

## What you will get
- **Vendor Invoices** (Finance & Accounting): list, new, detail, history. Number VI-YYYY-0001 by financial year (Apr–Mar). The vendor's own bill number cannot repeat for the same vendor.
- **Create invoice**: pick Vendor → PO → one or more posted GRNs. Vendor GSTIN/address, PO and GRN details fill in automatically. Lines default to accepted, not-yet-invoiced quantity at PO rate and tax. Invoice PDF/image upload (private storage, view/download).
- **3-way match** (PO vs GRN vs Invoice) per line: quantity, rate, tax, total. Tolerances (quantity %, rate %, invoice value ₹) set in Company Settings → Finance. Result: Matched or Exception, with each variance shown.
- **Exceptions**: Resolve (edit draft), Approve exception (Director, reason required), Reject (reason required). All recorded in history.
- **Approval**: Accounts review/approve; no self-approval. Only an approved invoice creates the payable. You cannot invoice more than was accepted at the GRN.
- **Accounts Payable**: total outstanding, due today, due in 7 days, overdue, partially paid, paid, vendor-wise outstanding; filters vendor/project/FY/due date.
- **Vendor Payments**: Scheduled → Approved → Recorded. Partial payments; invoice becomes Partially Paid / Paid. Payment mode, bank account (from company bank accounts), reference, date, proof upload. Directors approve payments; no self-approval.
- **Vendor Advances**: record advance payments, then adjust them against later invoices; advance balance shown.
- **TDS**: optional section/rate per invoice from Company Settings; shows gross, TDS, net payable. GST: CGST/SGST/IGST from the invoice lines, no invented rules.
- **Vendor Ledger / Vendor Account page**: opening balance, invoices (credit), payments and advances (debit), running balance; per FY.
- **Accounting foundation**: approved invoice posts Inventory/Expense Dr, GST input Dr, AP Cr (TDS payable Cr); payment posts AP Dr, Bank Cr. PO and GRN post nothing. Minimal chart of accounts only.
- **Project cost**: approved invoice amounts feed a project "actual cost" figure (no double counting with PO or GRN values).
- **Dashboard**: live AP outstanding, overdue, invoices pending approval, exceptions, payments this month; shows ₹0 / "No records" when empty.
- Sidebar unlocks Vendor Invoices, Accounts Payable, Vendor Payments, Vendor Ledger by permission.

## Roles
- Purchase Manager: create, review, match, view invoices.
- Accounts Manager / Accountant: review, approve invoices, schedule and record payments.
- Director: approve exceptions and payments, view all.
- Store Manager / Site Engineer: view related PO/GRN only; no invoice or payment approval.
- Auditor: view only.

## Technical details
- Migration: enums invoice_status (draft, pending_review, exception, approved, rejected, partially_paid, paid, cancelled), match_status, payment_status (scheduled, approved, recorded, cancelled), payment_kind (invoice, advance); tables vendor_invoices, vendor_invoice_items (po_item_id, grn_item_id, qty, rate, tax), vendor_invoice_grns, vendor_invoice_events, vendor_payments, vendor_payment_allocations, vendor_advances adjustments, accounts (minimal COA), journal_entries + journal_lines (append-only), vendor_ledger view; companies gets finance_settings jsonb (tolerances, TDS sections). goods_receipt_items gets invoiced_quantity. UNIQUE(vendor_id, vendor_invoice_number). All with GRANTs + RLS via has_permission + can_access_project, audit triggers.
- RPCs (SECURITY DEFINER, status only through them): create_vendor_invoice, run_invoice_match, invoice_transition (submit/approve/approve_exception/reject/cancel), payment_transition (schedule/approve/record/cancel), apply_advance. Journals posted only inside approve/record.
- Permissions: vendor_invoice.view/create/review/approve/approve_exception, payable.view, payment.view/schedule/approve/record, ledger.view; mapped to roles above.
- Storage bucket vendor-documents (private, signed URLs).
- Routes under /finance/: vendor-invoices (index/new/$id), payables, payments (index/$id), vendor-ledger, vendors.$id account page; Company Settings finance tab; dashboard cards.
- AGENTS.md rule: invoice/payment status and journal postings only through the RPCs; ledgers append-only.
- Verification: typecheck, build, and a scripted run of PO → GRN → invoice → match → approve → partial payment → ledger once a signed-in session is available.
