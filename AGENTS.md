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
- Permanent deletion uses a company-scoped Super Admin database function with row locks and reference checks; staff auth deletion additionally uses an authenticated server function, so linked history is never cascade-deleted.
- Super Admin data cleanup removes only unused masters and unsubmitted draft PR/RFQ/PO/invoice/GRN records after checking header and line dependencies. Preserve creation/edit metadata and deletion snapshots in immutable audit history; actual submissions, decisions, status changes and ledger entries stay protected. Keep save-retry receipts as tombstones. Posted documents use their existing cancellation/void/return workflows.
- Push delivery uses the shared transport with manual redirects; Workers reject error mode, and provider redirects must never be followed.
- Director device registration reconciles on workspace entry and focus after permission is granted; first-time permission requests run only from a notification-bell tap to respect browser consent.
- Keep Phase 1 limited to authenticated master data; introduce transactional tables only in their approved phase.
- Use project-scoped RLS for operational locations and separate role assignments from user profiles to prevent privilege escalation.
- Keep the ERP authentication-first: `/` redirects to `/auth`, and authenticated users continue to `/dashboard`.
- Directors may create PRs and finalize their own PRs where `pr_transition` permits, but **nobody can approve their own purchase order**. All POs—including Director-created and Super Admin-created orders—must enter `pending_approval`; a separate authorized Director must approve through `po_transition`. Migration `0100` also enforces `approved_by IS DISTINCT FROM created_by` at the database level. Preserve the PR → RFQ → quotation → PO source chain and independent approval history.
- Purchase request status changes only through the pr_transition database function; direct edits are limited to the requester's drafts, so approval history stays trustworthy.
- RFQ status and vendor awards change only through rfq_transition / rfq_mark_vendor_declined / record_vendor_selection database functions, so the PR → RFQ → quotation → selection trail stays auditable.
- Purchase order, goods receipt and stock changes happen only through po_transition / create_po_from_selection / create_goods_receipt / post_goods_receipt / cancel_goods_receipt / set_grn_disposition / short_close_po_line / execute_stock_transfer / create_stock_adjustment database functions; the stock ledger (inventory_transactions) is append-only, so every material movement traces to its source document.
- Vendor invoice, payment and advance status changes and all journal postings happen only through save_vendor_invoice / invoice_transition / schedule_vendor_payment / payment_transition / apply_vendor_advance; finance tables have no direct write policies and journals are append-only, so PO = commitment, GRN = receipt, approved invoice = payable, recorded payment = cash movement.

- Lovable-managed `.env` must be eligible for source sync and **contain public values only**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, optional project ID and server-side equivalents. The public anon / `sb_publishable_` key is NOT a service-role key. **Never commit any `sb_secret_` key, service-role JWT, DB password, SMTP password, or other secret**. Check via `node scripts/check-public-env.mjs --require` before tracking `.env`. Deployment platform may inject env variables instead; never hardcode secrets as an app fallback.
- A normal `npm run build` can succeed without Supabase browser configuration but the published `/auth` route will fail at runtime. When diagnosing blank previews, check the published VITE_ environment and deployment state; GitHub CI only validates static build syntax.

- Profile email changes require server-verified OTPs from both real inboxes; first email attachment requires the new inbox only. Never activate an email before proof completes. Verification material stays server-only, expires, and is rate limited.

## Documentation and data safety

- Treat numbered SQL migrations, Supabase configuration, source documents, ledger history, staff roles, purchase requests, purchase orders, vendor invoices, payments, attachments, and database records as **protected**. A Markdown cleanup is not authorization to edit, truncate, or delete any of them.
- Keep `AGENTS.md`, `README.md`, the maintainer guides, `.lovable/north-star/`, and `.lovable/plan/` unless their owner explicitly approves removal. Keep dated investigations in `docs/archive/` as historical evidence; do not mistake them for current production instructions.
- Use `docs/purchasing-authority.md` and the current, applied SQL function as authoritative for approval behavior; historical migration documents describe their own release, not necessarily current behavior.
- For documentation-only changes, limit the GitHub diff to `.md` files, review references before removal, run normal repository checks, and make changes through a reversible pull request. Do not deploy SQL or use production credentials.
