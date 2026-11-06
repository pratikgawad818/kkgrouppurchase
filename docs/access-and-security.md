# Access and security guide

For the successor and company administrator. This document describes source-verified controls and handover responsibilities; it is **not** a penetration-test certificate or a guarantee that the live hosting configuration is secure.

## Ownership and repository visibility

At the 6 November 2026 inspection, GitHub reported `pratikgawad818/kkgrouppurchase` as a **public repository** owned by an individual account. The company must decide whether its code and change history should remain public and arrange company-controlled administration. A visibility change can affect integrations; plan and validate it rather than changing it during a handover.

The connected hosting project and Supabase infrastructure are **separate assets**. Granting access to one does not automatically provide access to the others. Keep an independent company administrator and backup recovery contact for each service. Do not share the outgoing developer's personal login.

## Authentication and authorization

- Sign-in supports staff email/password and approved username-based accounts. Password reset and verified email changes use separate flows.
- `src/lib/session.ts` reads the current profile, permission set and roles. `src/lib/page-access.ts` controls route visibility; these checks do **not** replace server authorization.
- PostgreSQL RLS restricts row reads and permitted edits. Important status changes go through privileged SQL functions which check company, project, actor and document state.
- `public.ensure_profile()` provisions a missing profile but **does not assign a role** after migration `0067`. The database profile default remains active; review the signup policy and whether uninvited accounts should be inactive before wider access.
- Administrator actions must not automatically grant `super_admin`. The successor should verify which role grants are actually permitted by active SQL policies and server functions, not by UI buttons alone.
- Users with multiple roles may receive the union of permissions. The current route guard and RLS rules must be reviewed together when changing access.
- Project-scoped records require project assignment or a permitted company-wide project view. Never remove those checks for convenience.

### Role responsibilities

| Role | Typical responsibility |
| --- | --- |
| Super Admin | Company configuration, authorized staff/role administration, exception handling |
| Director | Review and decide on permitted purchasing/payment workflows |
| Purchase Manager | PR/RFQ/quotation/PO procurement operations |
| Store Manager | Receipts, inventory and stock workflows |
| Project Manager / Site Engineer | Assigned project and site operations |
| Accounts Manager / Accountant | Vendor bills, finance configuration and permitted accounting operations |
| Auditor / Management Viewer | Selected read-only business and management reporting |

These are **descriptions**, not grants. Confirm actual permissions from `role_permissions`, `user_roles`, active RLS policies and the current SQL functions before making access decisions. Some historical guides contain superseded director-quorum notes.

## Credentials and data handling

| Credential / data | Appropriate handling |
| --- | --- |
| Supabase URL and publishable key | Approved environment configuration; public browser configuration only where intended |
| Supabase service-role or secret key | Server-side company vault and deployment secret management; never in browser or Git |
| Database password / backups | Company-controlled privileged vault and protected restore locations |
| SMTP, email and push provider secrets | Server-only provider/hosting secrets, rotated on handover |
| Admin account and recovery codes | Named owner accounts and secure recovery store; no password sharing |
| Vendor invoices and payment proofs | Protected `vendor-documents` storage, authorized record-linked reads |
| User personal information and vendor banking | Need-to-know access and restricted diagnostic logs |

The tracked `.env` is intended to contain **publishable** configuration only. Run:

~~~sh
node scripts/check-public-env.mjs --require
~~~

before accepting any source change that updates environment configuration. Never commit `sb_secret_` tokens, service-role JWTs, SMTP credentials, webhook signing secrets, bank details or user passwords. If a secret is exposed, revoke/rotate it and follow the company's incident process; deleting a commit does not remove exposure from history.

## Safe new-maintainer onboarding

1. The company's authorized administrator invites the successor to GitHub, hosting, database and relevant support tools using their own account.
2. The successor demonstrates read-only access to the correct project and repository, then receives only the administrative rights needed for the role.
3. The outgoing developer transfers design decisions, build instructions, runbooks and outstanding issue context. Do not transfer personal authentication sessions.
4. The successor independently verifies a recoverable backup and can open a branch/PR; the company records a private support and recovery contact.
5. Once access is validated, remove unneeded outgoing access and rotate credentials that were personally controlled or cannot be safely transferred.

## Security testing before future changes

- Confirm unauthenticated or uninvited users cannot see company details or operational records.
- Check deactivated users, accounts without a role, cross-company users and unassigned-project users.
- Exercise attachment access with permitted and denied staff, including previously generated signed URLs after expiration.
- Test staff creation, approval decisions and payment workflows with distinct authenticated accounts.
- Review whether every client-callable privileged function validates `auth.uid()`, project/company membership, role and current document state.
- Review financial precision, duplicate requests/retries, out-of-order approvals and concurrent GRN/invoice/payment actions.
- Keep all security regression tests isolated from genuine vendor, inventory, payroll or payment records.

## Known review points (not automatically defects)

- New profile creation uses `ensure_profile()` with no automatic admin role; however it still selects the first company and inherits the profile's `is_active` default. The production signup policy must be inspected before describing the real-world exposure.
- The Super Admin staff-creation form currently displays an entered password in a plain-text field. Consider a masked input and safer account provisioning workflow in a separately reviewed change.
- The in-app attachment viewer uses temporary browser object URLs. Review cleanup behavior, memory limits, accessibility and mobile PDF support before future viewer work.
- Code CI cannot independently prove outbound email/push delivery or company account recovery; run authorized staging tests.

## Source references

- `src/routes/auth.tsx`, `src/routes/reset-password.tsx`
- `src/lib/admin.functions.ts`, `src/lib/session.ts`, `src/lib/page-access.ts`
- `src/lib/verified-auth.ts`, `src/integrations/supabase/`
- `drizzle/migrations/0067_ensure_profile_no_admin_bootstrap.sql`
- [Role-based page access](role-based-page-access.md)
- [Purchasing authority](purchasing-authority.md)
- [Operations runbook](operations-runbook.md)
