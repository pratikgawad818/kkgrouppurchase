<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep ERP modules connected through source-document foreign keys and immutable ledgers so every material and monetary movement is traceable.
- Keep Phase 1 limited to authenticated master data; introduce transactional tables only in their approved phase.
- Use project-scoped RLS for operational locations and separate role assignments from user profiles to prevent privilege escalation.
- Keep the ERP authentication-first: `/` redirects to `/auth`, and authenticated users continue to `/dashboard`.
- Purchase request status changes only through the pr_transition database function; direct edits are limited to the requester's drafts, so approval history stays trustworthy.
- RFQ status and vendor awards change only through rfq_transition / rfq_mark_vendor_declined / record_vendor_selection database functions, so the PR → RFQ → quotation → selection trail stays auditable.
- Purchase order, goods receipt and stock changes happen only through po_transition / create_po_from_selection / create_goods_receipt / post_goods_receipt / cancel_goods_receipt / set_grn_disposition / short_close_po_line / execute_stock_transfer / create_stock_adjustment database functions; the stock ledger (inventory_transactions) is append-only, so every material movement traces to its source document.
- Vendor invoice, payment and advance status changes and all journal postings happen only through save_vendor_invoice / invoice_transition / schedule_vendor_payment / payment_transition / apply_vendor_advance; finance tables have no direct write policies and journals are append-only, so PO = commitment, GRN = receipt, approved invoice = payable, recorded payment = cash movement.

- Keep the managed `.env` (publishable backend URL/key only) tracked and never gitignore it; the published build reads it at build time and the site goes blank without it.
