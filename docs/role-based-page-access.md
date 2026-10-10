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
