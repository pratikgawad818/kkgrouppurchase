# Operations runbook

**Applies to:** KK GROUP ERP production deployment and its connected PostgreSQL/Supabase project.  
**Audience:** named company administrator and approved technical maintainer.  
**Change policy:** no unreviewed production schema edits, direct writes to financial ledgers or ad hoc deletion of business records.

This runbook describes the existing operating model. It does not authorize publishing, migrating, deleting or modifying production data. Confirm current permissions, hosting and backup features before using any procedures.

## Production services

| Service | Known location or entry point | Purpose |
| --- | --- | --- |
| Web application | https://kkgrouppurchase.lovable.app | Staff entry point |
| Source control | `pratikgawad818/kkgrouppurchase` | Application code, migrations and tests |
| Connected hosting project | Existing connected project, not a new clone | Build, runtime configuration and publication |
| Database | Supabase project referenced by `supabase/config.toml` | Records, Auth, RLS, Storage, SQL functions |
| GitHub CI | `.github/workflows/verify-erp-pr.yml` | Automated build and disposable database regressions |
| Provider configuration | Hosting/project settings; company-managed vault | Private credentials, recovery and billing |

Do not assume a GitHub commit is automatically published. A change may sync to the editor while the production deployment remains on an earlier build. Database migrations are independent of both actions.

## Daily checks (read-only)

1. Confirm the application login route loads on desktop and a mobile-sized screen; identify the deployed revision where available.
2. Using a designated company account, confirm staff can access permitted modules and are blocked from unauthorized modules.
3. Inspect application errors and relevant deployment logs; group failures by authentication, network, database, application and notification service.
4. Confirm scheduled backups and monitor Supabase project health. A backup job showing success is not evidence of a recoverable restoration; retain a dated restore-test record.
5. Reconcile any failed/exception document queues, unmatched vendor bills and failed in-app/push notifications. Do not automatically approve or pay these items.
6. Review stock valuation warnings and unposted GRNs; quantities received, accepted, rejected and issued must remain distinct.
7. Record the check, owner, timestamp and any follow-up in the company's support system, not in application source files.

## Deployment / release procedure

**Before a release**

- [ ] Approved change request describes scope, affected roles, data migration and rollback path.
- [ ] Current Git branch and commit are recorded; reviewers compare against the latest main branch.
- [ ] Unit/domain tests, type checking, lint and CI database suites succeed.
- [ ] Where SQL changes: take a restorable backup, test the exact migration on isolated staging, check expected RLS and function privileges, and verify migration ordering.
- [ ] Where email, attachment, notification or auth logic changes: complete real staging tests with authorized separate accounts.
- [ ] Confirm the selected hosting project, Supabase project and environment variables match the intended company.

**Deploy**

1. Merge an approved PR only after tests and review; do not rewrite published branch history.
2. Confirm the expected code revision is present in the connected editor/build environment.
3. When necessary, apply the reviewed forward SQL migration using the authorized production migration process. **Never execute the full migration history against a live database.**
4. Publish or update the connected production app through the hosting platform's explicit release control.
5. Verify login, dashboard, representative read-only records, direct route navigation and a restricted-role login. For a transaction change, perform approved staging end-to-end checks before any production write.
6. Capture the deployed commit, applied migration revision, time, operator, backup ID and smoke-test result.

**If validation fails**

- Stop further rollout and notify the company owner.
- For application-only regressions, restore the previously known-good deployment if supported. Verify its compatibility with the current database.
- For database problems, prefer an explicitly reviewed **forward correction** rather than dropping or reversing live historical data.
- Restore backup only with company authorization and an assessed recovery point; restoring production can discard later legitimate transactions.
- Reconcile vendor invoices, approvals, payment journal balances and inventory movements before resuming business transactions.

## Local / CI validation

~~~sh
bun install --frozen-lockfile
bun run check
bun run lint
~~~

The CI workflow runs 14 jobs on the inspected 6 November baseline, including separate PostgreSQL suites. Disposable database tests use guarded database names and isolated fixtures; they must never be pointed at production. Review `scripts/db/` prerequisites before any direct invocation. A successful build or green CI **does not** prove live email delivery, browser authentication, storage authorization or rollback success.

## Backup and restore

- Assign a named primary and secondary backup operator.
- Record the database backup schedule, retention, storage location and whether point-in-time restore is available for the actual plan.
- Record recovery objectives (acceptable downtime/data loss) and the escalation chain in the company's **private** operations register.
- Include SQL database, storage attachments and essential provider configurations; a database snapshot alone may not recover file objects or authentication settings.
- Periodically restore into an **isolated** project and inspect companies, role assignments, master records, open POs, GRNs, warehouse stock, vendor liabilities, journals and attachments.
- Compare record counts and financial/stock aggregates before and after restore. Preserve transaction and approval history.
- Never copy real production personal/vendor information into an unsecured staging project.

## Incident triage

| Symptom | Initial investigation | Do not |
| --- | --- | --- |
| Blank login screen | Deployment status; browser `VITE_SUPABASE_*` public config; network/console errors | Paste privileged credentials into client bundle |
| Staff denied access | Active profile, assigned roles, project assignment, RLS, current session | Grant `super_admin` as a quick workaround |
| PO or GRN cannot proceed | Required previous document, status, accepted quantities and applicable RPC error | Update PO/stock tables manually |
| Vendor bill exception | PO/GRN references, invoice number, permitted quantity and tax/round-off | Force ledger or payment postings |
| Payment imbalance or duplication | Approval history, invoice allocations, cash reference and append-only journal | Reissue payment blindly |
| Document viewer fails | Object storage access, signed URL lifetime, file type/size and client errors | Make financial documents public |
| Notifications unavailable | Staff consent, push subscription, email sender, transport error and hosting logs | Disable security checks or expose token |
| Dashboard performance | Network requests, paging caps, query keys, server latency | Remove RLS or load entire tables into the browser |

Use the issue tracker with severity, reproduction, affected module, role, time, screenshot stripped of sensitive information, expected behavior, actual behavior and the last known-good revision.

## Change boundaries

- **No routine data cleanup:** delete only through authorized ERP functions that preserve reference checks and audit history.
- **No direct ledger or stock writes:** use appropriate business workflows and their transactional RPCs.
- **No manual approval fabrication:** preserve actual actor, company and time.
- **No hardcoded user permission exceptions:** align route access, role grants and SQL authorization.
- **No removal of historical migrations:** migration replay and audit evidence depend on them.
- **No assumption that external integrations still operate:** the Google Sheets and WhatsApp ERP integrations have been retired.
- **No invisible deployments:** a PR merge, build, database migration and publication are separate auditable events.

## On-call / operational records

Store named contacts, private recovery codes, monitoring destinations, hosting billing and credential inventory **outside Git** in company-controlled systems. Suggested fields: system, owner, secondary owner, severity contact, admin-access method, credential-vault entry ID, renewal date, last restore test, last deployment, and unresolved risks. Do not store actual passwords or tokens in this repository.

See [HANDOVER.md](HANDOVER.md) for the formal successor sign-off and [access-and-security.md](access-and-security.md) for the privilege review.
