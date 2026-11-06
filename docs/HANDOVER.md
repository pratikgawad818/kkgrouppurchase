# KK GROUP ERP — maintainer handover

**Document date:** 6 November 2026  
**System:** KK GROUP internal construction operations ERP  
**Production URL:** https://kkgrouppurchase.lovable.app  
**Source repository:** https://github.com/pratikgawad818/kkgrouppurchase

This is the starting point for the incoming maintainer. Read this file, then the [developer guide](developer-guide.md), [operations runbook](operations-runbook.md), and [access and security guide](access-and-security.md). Keep the documents in the repository alongside the application; update them when the corresponding procedures change.

## Current handover baseline

- Last inspected main-branch commit: `d6655fc14fec968991889e0c9141f7201603e18d` (6 November 2026).
- The connected project was reported ready, and its latest commit matched GitHub at inspection.
- GitHub Actions had **14 successful jobs** for that revision, including type checking and disposable PostgreSQL tests. These are automated checks, not a substitute for authenticated browser acceptance.
- The production database was inspected on 6 November: the `ensure_profile` security function from migration `0067` was present; 68 migration ledger records were observed. Record the actual migration state again before the next release.
- The ERP's Google Sheets OAuth and scheduler integration is retired. Archived import/cost tables are deliberately retained for migration integrity; they were empty at the last inspection.
- WhatsApp sending is retired; director decisions remain inside the ERP. Current purchasing-authority notes document a **one independent Director** approval policy in the applicable flow. Some older test documents describe an obsolete three-director rule: do not implement historical assumptions.
- No application behavior, database data, UI, or production deployment is changed by this documentation handover.

## What the application does

The system maintains one company's projects, buildings, floors and units; suppliers and materials; PRs, RFQs, quotations and POs; delivery challans and GRNs; warehouses, stock movements, material issues and returns; invoices, advances, payments, petty expenses, ledger reports, project costing and approvals. The database is the source of truth. A spreadsheet or external messaging integration is **not** a system of record.

Business sequence:

~~~text
Project / building / material master
  -> Purchase request -> RFQ -> supplier quotation and selection
  -> Purchase order -> supplier challan -> goods receipt (GRN)
  -> Accepted stock -> material issue / return -> project consumption
  -> Matched invoice -> approval -> payment recording -> accounting reports
~~~

Not every cost or payment flows through the full PO chain (for example, opening vendor bills and controlled small expenses). Always use the appropriate native process; never backfill financials with direct table edits.

## Ownership and access transfer — company action required

The source repository is currently under an individual GitHub account, and the connected app is hosted in a separately managed workspace. **Code delivery is not account ownership transfer.** The company's authorized representative should establish company-managed ownership before the departing maintainer loses access.

| Asset | What the company must receive | Verification |
| --- | --- | --- |
| GitHub | Administrator access to the repository; ideally company organization ownership; branch protection and a named backup administrator | New maintainer can read history and open a test PR |
| Hosting / editor | Owner or administrator access to the **existing** connected project, not a cloned replacement | Authorized successor can inspect project, configuration, and publish permissions |
| Supabase / PostgreSQL | Project owner/admin access, Auth, Storage, migrations, RLS, recoverable backups | Successor can inspect schema and backup status without changing live data |
| Domain / hosting billing | Domain, DNS, hosting/subscription and billing contacts if applicable | Company confirms renewal and recovery access |
| Email / push providers | Authorized service administrators, sender configuration, alerts and billing | Test notification delivery in staging |
| ERP users | At least two company-approved admin recovery paths, operational staff/role inventory | Privileged access audited; no shared day-to-day credentials |
| Support | Named primary and backup maintainers, incident channel and escalation contact | Test an issue report and acknowledgement |

**Never hand over personal passwords, recovery codes, service-role keys or production database passwords in Git, documents, chat, or email threads.** Invite named administrators through provider access controls, then transfer any necessary credentials through a company-approved password vault and rotate credentials after the transfer. Do not remove the existing owner until the new owner has independently verified access and backups.

## Acceptance checklist

The incoming maintainer and company representative should complete and retain this checklist privately:

- [ ] Confirm repository default branch, current SHA and clean open-PR list.
- [ ] Confirm app's production URL and current deployment revision; verify that publishing is separate from merging.
- [ ] Sign in using a designated staff account; verify the dashboard, assigned modules, permissions, password recovery and logout.
- [ ] Check an existing PR, PO, challan, GRN, stock ledger, material issue/return, invoice, payment and expense **read-only**; reconcile key amounts with the source documents.
- [ ] Use a separate staging company/database for any create/edit/approve/pay tests; do not generate production transactions for demonstration.
- [ ] Verify company, project and role-level access boundaries using independent authorized accounts.
- [ ] Validate that database backups can be restored into an isolated environment.
- [ ] Confirm monitoring, error notifications, email sender, and app support ownership.
- [ ] Record company-controlled GitHub, hosting, database and domain administrative access.
- [ ] Document any unresolved defects and accepted operating risks, with assigned owners.
- [ ] Company representative and successor sign off on the transfer, including revocation timing for the departing maintainer.

**Handover record (complete outside version control):** effective date; outgoing maintainer; successor; company approver; repository/deployment/database revision identifiers; latest backup location and restore-test date; outstanding issues; approval signatures.

## First-day instructions for the next developer

1. Clone the same repository and review `README.md` plus [developer-guide.md](developer-guide.md).
2. Install the lockfile's dependency versions; configure only the approved publishable environment variables locally.
3. Run the local regression/build/typecheck command. Review the CI results for the checked-out commit.
4. Read the database [model](erp-data-model.md), [migration validation](database-migration-validation.md), [purchasing authority](purchasing-authority.md) and [material movements](material-issues-returns.md).
5. Obtain staging access before proposing any transaction or schema change. Use a feature branch and a reviewed PR; do not push unverified changes directly to the connected production branch.
6. Follow [operations-runbook.md](operations-runbook.md) for releases, backups and incident response.

## Deferred, non-blocking review items

No changes are being made as part of this handover, but the successor should review whether newly authenticated accounts must remain inactive until invited (the inspected `ensure_profile()` inserts a profile with the database's active default), ensure account creation passwords are masked, and test blob-URL cleanup and mobile PDFs in the attachment viewer. Do not claim these issues are exploitable without verifying the live authentication and access settings. Track findings separately and prioritize security fixes through normal change control.

## Documentation policy

The current operational guidance is in this handover set and the actively maintained workflow documents. Older dated reports, migration notes and acceptance records are preserved as historical evidence; they do not override later database policies or the currently deployed revision. Provider/framework references are retained when necessary to operate the application; the team should not falsify technical provenance or rewrite commit history.
