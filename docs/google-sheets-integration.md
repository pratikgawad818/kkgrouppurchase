# Google Sheets ↔ KK GROUP ERP (controlled historical bridge)

## Scope and deliberately enforced boundaries

A company Super Admin can open **Settings → Google Sheets Integration** and connect
one Google Spreadsheet by its full `docs.google.com/spreadsheets/d/…/edit` URL.
A spreadsheet can contain multiple tabs. The ERP creates reserved `ERP - …`
tabs if they do not already exist.

**Two-way, editable:** `ERP - Historical Consumption`. Used to backfill old
project/building/material usage, preserving a stable `Reference` across syncs.
Rows are validated, company-scoped, idempotent, and report status/errors next
to the source row. If the sheet and ERP change the same row after the last sync,
the row reports `CONFLICT` and neither side is automatically overwritten.
Deleting a worksheet row does not delete an ERP record.

**ERP → Google Sheets (read-only exports):** projects, materials, vendors,
warehouses, buildings, PRs, POs, GRNs, material issues, invoices and payments.
Some of these are financial or approval-controlled: edits in Google Sheets
do not become ERP writes. Append-only inventory and accounting journals, staff
roles, private documents, personal credentials and authorization data are never
exposed as editable spreadsheet tables. ERP permissions remain in force.

**Critical accounting rule:** historical usage is stored separately in
`erp_historical_material_consumptions`, not `inventory_transactions`.
It appears as a distinct section on the Project Material Consumption page,
but it does **not** reduce current stock, post cash, alter a vendor invoice,
or automatically change the stock-ledger-based cost totals. Before financial
backfill, reconcile warehouse opening balances, cutover dates and existing
posted issues; otherwise one historical purchase/issue may be counted twice.

## Required activation (nothing is connected by committing code)

1. Apply migration `drizzle/migrations/0055_google_sheets_historical_bridge.sql`
   only after production database backup, RLS review and migration preflight.
   It does not migrate or delete existing business records.
2. In a restricted Google Cloud project enable **Google Sheets API**, create
   a dedicated service account, and generate a JSON key if the chosen deployment
   requires one. Store the entire JSON **only** in the server secret
   `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` (never in GitHub code, VITE variables,
   Google worksheet cells or browser localStorage).
3. In Super Admin settings find the displayed service account email. Share
   only the intended private Google Spreadsheet with that email as **Editor**.
   Do not make the document publicly editable.
4. Paste its full Google Sheets URL. The server verifies actual API access,
   then stores its spreadsheet ID and display title, scoped to this ERP company.
   Click **Sync now** once. The ERP creates templates/exports.
5. Edit **ERP - Historical Consumption** in the Google workbook. In its
   **Reference** column enter a unique stable key such as `LEGACY-0001`.
   Use the actual Project/Building/Material codes from the ERP - … reference
   tabs. **Date** must be `YYYY-MM-DD` as text (set Google cell formatting
   to plain text); Quantity supports 3 decimals; Unit Cost INR supports 2
   decimals. Blank Building Code means general project work.
   Enter **0 explicitly** for an unknown monetary cost, and separately
   reconcile such records before using historical costs for decisions.
   Leave `ERP Record ID`, `Sync Status` and `Sync Error` alone.
6. For periodic sync, configure the **same** securely generated (≥32-character)
   `GOOGLE_SHEETS_SYNC_SECRET` as a server-only environment secret and the
   repository **secret** `KK_ERP_SHEETS_SYNC_SECRET`. Set repository **variable**
   `KK_ERP_SHEETS_SYNC_URL` to the deployed endpoint
   `https://<ERP-host>/api/public/google-sheets-sync`.
   `.github/workflows/google-sheets-sync.yml` schedules a secure POST about
   every 5 minutes, but GitHub does **not** guarantee a precise schedule.
   Manual sync is also available in settings.
7. Publish the backend and frontend from the connected branch only after
   checks pass and the environment/migration have been verified. A successful
   GitHub build does not mean a live database migration is applied.

## Operational guarantees and limitations

- The ERP database is the source of truth for approvals, finance and physical stock.
- The worker uses a 5-minute database lease to avoid overlapping sync jobs;
  failed sync attempts preserve errors for admins to review.
- Each import row is checked against the company's project, matching building
  and material codes. UUIDs are not accepted from arbitrary sheet rows.
- Exports are bounded; exceeding safety limits fails instead of silently
  truncating data. Repeated Google API writes are batched.
- The sync uses polling, **not instant live streaming**, and may be delayed by
  Google APIs, deploy downtime or GitHub scheduled job delays. Changes in the
  same row on both sides are not silently resolved.
- If an existing reserved `ERP -` tab has unexpected headers, do not
  overwrite it. Rename it or back it up, then let the integration create
  its own tab.
- **Full two-way editing of every ERP table is intentionally not supported.**
  Extending write access requires individual business-rule-aware workflows
  (e.g. item master upsert, approved purchase amendments, material issue RPCs).
  Mapping arbitrary columns to tables would bypass approval rules.

## Acceptance testing before activation

- An unauthorized user or cross-company admin cannot view/edit sync settings
  or the source history; confirm role and service account separation.
- Verify reference idempotency with two consecutive syncs and a spreadsheet
  reorder. Edit only Sheets, then only ERP, and check conflict handling.
- Test invalid project/building/material, negative and fractional quantity,
  duplicate Reference, and mismatched ERP Record ID.
- Compare stock balances and immutable inventory ledger before and after a
  historical backfill; there should be **no change**.
- Confirm that financial document mirror edits are never imported.
- Confirm a temporary Google permission revocation surfaces an actionable
  error and does not expose credentials or corrupt historic rows.
