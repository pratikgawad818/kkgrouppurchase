# KK GROUP ERP ↔ Google Sheets: direct no-client import and optional automatic sync

## Direct workflow (no Google Cloud client or service-account JSON)

**This is the recommended setup-free path.** The existing private Google Spreadsheet remains restricted to your organization. Super Admin staff do not need to configure an OAuth app, generate any Google token or expose the workbook publicly.

1. Open the original Google Sheet, choose `Entry - Project Costing`, `Entry - Vendor Challans`, `Entry - Vendor Invoices`, or `ERP - Historical Consumption`.
2. Select the **full header row (all columns)** plus up to 500 filled data rows and copy them (⌘C/Ctrl+C).
3. Open ERP → **Settings → Google Sheets Integration** → **Import directly**. Select the matching worksheet type and paste (⌘V/Ctrl+V). Click **Validate and stage for review**.
4. The ERP parses Google Sheets/Excel clipboard TSV, including correctly quoted multi-line values. The Super Admin reviews per-row errors and opens each staged document to verify amounts, supplier, PO and GRN references. Each **Confirm import into ERP** action uses the existing privileged ERP business workflows, not arbitrary direct SQL writes to financial or stock tables.
5. A direct paste is a **point-in-time snapshot**, not automatic synchronization. Editing the Google Sheet later does **not** update ERP. To submit additions/corrections that haven't been applied, paste again using the same stable reference; applied documents require controlled ERP reconciliation.

**Infrastructure prerequisite:** The ERP's server and database must have migrations `0055` and `0056` applied and PR #67 deployed. This is normal ERP deployment setup, **not** a Google account/client setup. A Google-account connection in ChatGPT does not authorize the ERP server.

The optional separate Google OAuth flow below is **only** for future unattended/private-sheet polling, not for direct imports.

## Actual behavior

The Super Admin opens **Settings → Google Sheets Integration**, pastes one spreadsheet URL and chooses **Connect with Google**. The Google consent screen authorizes that ERP application (not ChatGPT). No Google service-account JSON is required.

The following editable tabs in the *same* spreadsheet are supported:

- `ERP - Historical Consumption`: historical quantity and cost backfill; separate from current stock. Direct paste creates reviewed historical usage entries, while optional authorized synchronization uses reference-based conflict detection.
- `Entry - Project Costing`: individual historical cost entries by project and optional building. After review they become immutable `erp_project_cost_entries`, **not** posted expenses, payables or inventory transactions. Do not import a cost already present in an approved invoice or stock-consumption register; cost-control reconciliation remains necessary.
- `Entry - Vendor Challans`: multiple lines per Import Reference. Each line needs the existing PO line number and material code. Super Admin action calls `register_vendor_delivery_challan` using the signed-in user's credentials and ERP ACL/RPC rules; challan registration itself does not post a goods receipt.
- `Entry - Vendor Invoices`: multiple lines per Import Reference. Each bill references an existing PO and posted GRN items, including `GRN Line No` from the **`ERP - GRN Item References`** export. The Super Admin applies via `save_vendor_invoice` and creates **a draft only**. No invoice approval, payment, or journal posting from a sheet.

Both direct paste and optional Google sync stage `erp_sheet_import_documents` entries with `ready`, `processing`, `applied`, `error`, and `conflict` states. Authorized Google-sync records are re-checked against the live worksheet immediately before the apply operation. Direct pastes are immutable reviewed snapshots until resubmitted. Duplicate imported references cannot silently be applied twice. If a document was already applied and the sheet changes, the queue records a conflict; corrections require the ERP's standard workflow. All entry tabs are per-company. Only active Super Admins can configure OAuth and apply imports.

**Export-only ERP mirrors:** projects, materials, vendors, warehouses, buildings, purchase requests, purchase orders, goods received, material issues, vendor invoices and vendor payments. Staff should not edit these mirrors. For GRN line numbers use `ERP - GRN Item References`. The integration does not directly change immutable stock, invoice, payment or audit ledgers.

## Deployment prerequisites — for *optional* automatic private-sheet synchronization only

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

## Automatic sync: database scheduler (recommended)

Once migration `0057_google_sheets_database_scheduler.sql` is deployed, the production
Supabase database uses `pg_cron` + `pg_net` to trigger the server's protected
`/api/public/google-sheets-sync` endpoint every **5 minutes**. It does not require
GitHub Actions repository variables, GitHub secrets, or an extra Google login.

Security:
- Each request receives a random 256-bit, **single-use** token that expires after
  120 seconds; only its SHA-256 hash is stored in the private, RLS-enabled
  `erp_sheet_sync_nonces` table.
- Only the privileged `postgres` scheduled job can create a token. The database
  function denies invocation from `anon` and `authenticated`.
- The endpoint atomically deletes/consumes the token before syncing. Replays fail.
  No browser-facing key or permanent scheduler secret is required.
- The job skips disabled/unconnected workbooks. The existing `sync_lease_until`
  prevents concurrent syncs on a company.
- Existing Google Sheets synchronization **stages** costing/challan/invoice rows for
  explicit Super Admin approval and never auto-posts stock or supplier payments.

Production activation after the updated API route is published, as the database
administrator (not from the browser):

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
SELECT cron.schedule(
  'kk-erp-google-sheets-5min',
  '*/5 * * * *',
  'SELECT public.erp_enqueue_google_sheets_sync();'
);
```

Verify with `SELECT jobid,jobname,schedule,active FROM cron.job WHERE
jobname='kk-erp-google-sheets-5min';` and check `last_synced_at` in
`erp_google_sheet_connections` advances without any manual clicks.
Check `cron.job_run_details` and `net._http_response` for transport errors.

To stop: `SELECT cron.unschedule('kk-erp-google-sheets-5min');`. The old GitHub
workflow remains **manual only** to prevent duplicate schedules. GitHub schedule
activation is no longer required.

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
