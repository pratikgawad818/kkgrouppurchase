# KK GROUP ERP ↔ Google Sheets: account sign-in and controlled imports

## Actual behavior

The Super Admin opens **Settings → Google Sheets Integration**, pastes one spreadsheet URL and chooses **Connect with Google**. The Google consent screen authorizes that ERP application (not ChatGPT). No Google service-account JSON is required.

The following editable tabs in the *same* spreadsheet are supported:

- `ERP - Historical Consumption`: historical quantity and cost backfill; separate from current stock. Historical imports use reference-based conflict detection.
- `Entry - Project Costing`: individual historical cost entries by project and optional building. After review they become immutable `erp_project_cost_entries`, **not** posted expenses, payables or inventory transactions. Do not import a cost already present in an approved invoice or stock-consumption register; cost-control reconciliation remains necessary.
- `Entry - Vendor Challans`: multiple lines per Import Reference. Each line needs the existing PO line number and material code. Super Admin action calls `register_vendor_delivery_challan` using the signed-in user's credentials and ERP ACL/RPC rules; challan registration itself does not post a goods receipt.
- `Entry - Vendor Invoices`: multiple lines per Import Reference. Each bill references an existing PO and posted GRN items, including `GRN Line No` from the **`ERP - GRN Item References`** export. The Super Admin applies via `save_vendor_invoice` and creates **a draft only**. No invoice approval, payment, or journal posting from a sheet.

Staging creates `erp_sheet_import_documents` entries with `ready`, `processing`, `applied`, `error`, and `conflict` states. A changed or deleted sheet row is re-checked immediately before the apply operation. Duplicate imported references cannot silently be applied twice. If a document was already applied and the sheet changes, the queue records a conflict; corrections require the ERP's standard workflow. All entry tabs are per-company. Only active Super Admins can configure OAuth and apply imports.

**Export-only ERP mirrors:** projects, materials, vendors, warehouses, buildings, purchase requests, purchase orders, goods received, material issues, vendor invoices and vendor payments. Staff should not edit these mirrors. For GRN line numbers use `ERP - GRN Item References`. The integration does not directly change immutable stock, invoice, payment or audit ledgers.

## Deployment prerequisites — required before connecting

1. Back up the database; apply migrations **0055** and **0056** in order, reviewing RLS and PostgreSQL regression tests in staging before production deployment.
2. In Google Cloud create or choose a restricted project. Enable **Google Sheets API**. Configure **OAuth consent screen** (external test users, if testing, or approved production audience) with `https://www.googleapis.com/auth/spreadsheets` and `openid email` scopes. Create an **OAuth client ID of type Web application**.
3. Set the **Authorized redirect URI** on the Google OAuth client to precisely `https://kkgrouppurchase.lovable.app/api/public/google-sheets-oauth` (use the actual final deployed ERP host, HTTPS, if different).
4. Set **server-only** secrets:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REDIRECT_URI`, exactly the URI registered in Google Cloud
   - `GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY`, a random 32-byte key encoded as 64 hexadecimal characters. **Keep a secure backup**: losing or rotating it without migrating stored tokens forces reconnection.
   Never commit credentials, publish them in `VITE_*`, or paste them into a worksheet/chat. AES-256-GCM encrypts refresh tokens in the DB; do not log tokens.
5. Publish a server runtime that supports TanStack Start API routes and the Google callback. From **Settings → Google Sheets Integration**, paste the Google Spreadsheet URL, click **Connect with Google**, select the Google account with editor access to the workbook, and approve the requested scopes. If the sheet is **Restricted** (recommended), the selected Google account must explicitly have access to it.
6. Click **Sync now**. The integration generates the ERP reference export tabs and checks the entry tab headers. It will refuse to overwrite unexpected headers. The sheet link alone does not activate backend credentials or database migrations.
7. For background polling, set the protected deployment secret `GOOGLE_SHEETS_SYNC_SECRET` (minimum 32 characters); configure the same value in the GitHub repository secret `KK_ERP_SHEETS_SYNC_SECRET`; set repository variable `KK_ERP_SHEETS_SYNC_URL` to `https://kkgrouppurchase.lovable.app/api/public/google-sheets-sync`. The existing cron runs about every 5 minutes but GitHub scheduling is not guaranteed. **Sync now** works without the scheduler. Automatic sync only stages costing/challan/invoice rows: each needs an explicit import decision.

## User instructions

The linked sheet's entry tabs have been prepared already:
- `Entry - Project Costing`: one cost per Reference, date `YYYY-MM-DD`, ERP project/building code, cost category, description, quantity×rate or amount. Be certain costs aren't captured in other registers; a nonblank Invoice/Challan Ref forces reconciliation instead of duplicate counting.
- `Entry - Vendor Challans`: one row per material, repeat the same Import Reference for one challan, and specify actual PO line no/material/quantity. Match the approved PO project and vendor.
- `Entry - Vendor Invoices`: one row per posted GRN item, repeat Import Reference for one bill; all rows need GRN number, material, quantity, rate, GST type and rate. Only the first row may contain freight and other charges. GRN Line No is from the exported GRN item reference tab.
- `ERP - Historical Consumption`: use actual material/project/building codes; keep stable reference keys. This area is independent of live warehouse inventory.
- Keep generated `ERP Record ID`, `Import Status`, `Import Error`, `Sync Status`, and `Sync Error` fields unchanged. Errors are reported in the workbook; review them in ERP settings.

**Current-account boundaries:** a Google account connected to ChatGPT's Google Drive connector is NOT automatically authorized in the ERP. The ERP OAuth consent screen is a separate permission grant. Any Google Sheet shared as `Anyone with the link → Editor` is inappropriate for vendor costing and invoices; change General access to **Restricted**.

## Test and acceptance checklist

- Google account can connect and reconnect; repeat callback/state fails; lost or revoked permission fails safely, without token leakage.
- A non-admin or cross-company user cannot see/apply staged rows. OAuth permissions remain restricted to requested spreadsheet's owner/editor account.
- Cost: duplicate reference cannot create duplicate costs; linked invoice cost requires reconciliation.
- Challan: reject wrong vendor/project/PO line/material, exceeding PO quantity or a duplicate challan; register only via existing security-definer RPC.
- Invoice: reject non-posted GRNs, wrong PO/material/GRN line, duplicate bill, duplicate GRN item, tax type/rate mismatch or excess accepted quantity; save draft via existing RPC.
- Sheet edit or deletion after staging blocks approval until restaged. No silent mutation of approved invoice, ledger or warehouse stock.
- Run CI, replay full database migrations and test on **a disposable staging database**, then test a temporary restricted Google workbook. A build passing is not proof of Google OAuth API or production database connectivity.

## Caveats

- Two-way data editing is intentionally **limited** to historical material usage. Other entry tabs stage one-way into ERP and are not general-purpose bidirectional financial editors.
- Project historical costing is stored independently; the core Project Cost Control headline totals are unchanged until finance reconciles whether expenses duplicate posted invoices.
- GitHub Actions can be delayed or skip a run. These functions are polling-based, not transactional zero-latency events.
