# KK GROUP ERP — role-specific screens and data access

This source change protects **sidebar navigation, direct route URLs, and nested edit/create forms** through one explicit, default-deny `canAccessPage` mapping. A hidden menu is not used as authorization.

## Roles and interface

| Account | Typical visible modules | Transaction rights |
|---|---|---|
| Super Admin (operator) | All modules for which Supabase grants permissions | Existing audited RPC permissions; no automatic bypass |
| Management Viewer (existing Auditor role) | Management Overview, Stock, Stock Movements, Project Consumption, Project Cost Control, Payables and Payments | **None on these screens**; server and RLS must still deny writes |
| Purchase Manager | Projects relevant to their role, suppliers, purchase requests, RFQs, quotes, POs | Only permission-granted workflow transitions |
| Store Manager | Inventory, receipts, material issues and allowed PRs | Only permitted stock operations |
| Accounts / Accounts Manager | Invoices, payables, payments and ledger where granted | Only permitted payment/accounting actions |
| Site Engineer / Project Manager | Assigned projects, construction and material activities | Limited by permissions and project assignment |

An account with multiple roles receives the **union of explicit permissions**; only a sole `auditor` account gets the dedicated Management Viewer whitelist.

## Route guard

- Before rendering an authenticated page, the app checks its concrete path against explicit read/write requirements. Unknown paths are denied.
- `/procurement/purchase-requests/$id/edit`, `/procurement/rfqs/$id/quotation`, `/procurement/rfqs/new`, and `/finance/vendor-invoices/new` require explicit edit/create capabilities. A `*.view` permission is insufficient.
- The sidebar and global search derive destinations from the same guard; the mobile home/logo and Settings menu respect management-viewer access.
- Users without a role and deactivated users still get the existing access-block message.
- Access denials do not mount the protected React page component, so its client-side data queries are not started by that screen.

## User management hardening

- The user-management list is explicitly filtered to the signed-in company; role queries reference only those profile IDs.
- The staff mutation handler verifies company membership independently, even when called directly.
- The staff editor cannot create, remove or deactivate `super_admin` roles; nor may an administrator accidentally remove their own role while editing contact information.
- Inviting staff requires an active company and `users.manage` authorization.

## Security limitations / deployment gates

**Browser page checks are not an API security boundary.** Existing RLS policies and SQL SECURITY DEFINER RPC permission checks are still authoritative. The previously proposed migration `0019_management_viewer_scope.sql` must be deployed with backup/verification before the boss receives its new view permissions. Some older profile/company/project RLS policies have broad company visibility; a separate company-isolation audit and migration are required before claiming multi-company certification.

Changing profile details and role assignments currently uses multiple HTTP requests rather than one transaction. Concurrency and rollback protection for these administrator writes should be moved into an audited server-side transaction before broad staff rollout.

The existing **three-director PO/payment quorum** remains unchanged. This PR does not change live data, user accounts, Supabase schema, Lovable credits or publication.


## Pending company and project RLS migration 0020

The original schema's `projects.view_all` authorization was not company-scoped; some profile, company, company-bank, and user-role policies also granted reads/updates based only on a global permission name. Migration `0020_company_staff_scope.sql` adds active actor/company membership enforcement to these policies and limits project access to projects within the actor's company (plus existing project assignments).

It also prevents direct authenticated client inserts of the `super_admin` role. A dedicated disposable PostgreSQL suite tests independent company administrators, assigned-site readers, read-only management users, cross-company reads/updates, role grants and project assignments.

**Rollout warning:** This migration has not been applied to the live Supabase instance. It must follow 0019, be reviewed with the active schema and actual staff/company records, and be staged with rollback/backup procedures. It improves the named policies, but does not certify all historical ERP table policies, document storage, or accounting workflows. Never equate a hidden page with secured database data.

## Migration 0021 — operational records and attachment isolation

Review found older SELECT policies checked `payment.view`, `vendors.view`, `materials.view`, `inventory.view` or `ledger.view` without also checking **company membership**. Consequently, knowing another tenant's API endpoint could expose supplier bank details, item masters, payment proofs and even journals despite hidden navigation.

Source-only `0021_tenant_operations_storage_acl.sql` fixes the named policies for:
- Vendor and material masters, categories, units of measure, related vendor-category links and central/project warehouses (including write policies).
- Stock-transfer headers and lines.
- Vendor payments, payment allocations, advance adjustments and lifecycle events.
- Chart-of-accounts and journals (including journal lines).
- Audit log rows, restricting to originating staff's company, with unattributed system logs excluded until audit logs acquire a reliable company ID.
- Vendor-document storage: invoice and payment attachments are readable only if **linked** to a permitted record. Unlinked uploads are denied read until linked; other buckets are not granted.

It also trims historic `auditor` role grants to the Management Viewer whitelist, removing excess purchase request, RFQ, quotation-compare and journal permissions.

A new extension of the company RLS CI suite exercises the actual migration on two synthetic companies, a management viewer, a store operator, files, vendor/stock/payment rows, ledger data and direct unauthorized writes.

**Review before deployment:** SQL must be applied **after 0019 and 0020**, transactionally in staging, then verified with real staff roles. Existing unattached invoice proofs may cease to be retrievable by staff until relinked to a recorded invoice/payment; service-role recovery remains possible. This migration covers the named policies, not every Supabase function, storage bucket, cron job, or historical ledger export. The live production DB was not changed.
