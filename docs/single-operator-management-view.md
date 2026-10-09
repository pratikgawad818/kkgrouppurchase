# KK GROUP: single operator and management viewer

## Who uses it
**Operator:** the ERP administrator handles materials, stores, stock movements, purchases, and recorded costs. **Boss:** a separate **Management Viewer** account (backed by the existing read-only `auditor` role) can sign in to monitor company data. Do **not** assign the boss `director`, `purchase_manager` or `super_admin` simply to obtain reporting access.

## Dedicated reporting screen
The Management Overview at `/management` shows where each material is stored, quantities, project-linked locations, stock asset value, project material usage, approved supplier bills still unpaid, and cash payments already recorded. Data is filtered to the signed-in company; complete-register paging is verified before totals are displayed. There are no create/edit buttons on this page, and the Management Viewer sidebar shows only reporting/read-only destinations.

**Accounting caveat:** These are separate stages. Stock on hand is an asset; issued material cost is a project cost; approved invoices represent supplier liabilities; recorded payments are cash movement (including advances). **Never sum these cards into a single "total expense."** Labour, subcontractors, equipment, indirect overhead and other expenses are NOT tracked by this screen unless separately entered elsewhere.

## Access migration (not automatically deployed)
Migration `0019_management_viewer_scope.sql` grants existing Auditor role only VIEW permissions, including full accessible project read access. It also tightens the warehouse stock and stock movement RLS policies to the viewer's company and project. It must be reviewed, backed up and deployed before expecting new boss reporting rights on the connected database. Until applied, a boss session may not be able to read all reports.

## Important open blocker: approvals
The existing purchase order and payment workflows **still require three real director votes** in the database. This change deliberately does NOT silently bypass approval or record payments without a vote. Before enabling actual purchases/payments for a one-operator company, a separately specified and tested solo-operator transaction policy must replace the current quorum rules, preserving creator identity, ledger traceability, and audit entries. In the meantime, basic stock can be entered using the existing authorised opening-stock and adjustment workflow; material issue/return records determine the material usage amounts above.

## Operational checklist
1. Create projects, site stores and materials.
2. Enter verified opening stock or post goods receipts through an approved process.
3. Issue materials to projects and register returns so project usage is correct.
4. Invite the boss as Management Viewer after migration 0019 is safely applied.
5. Validate stock totals and management cards using real separated logins on desktop and mobile.

Source changes in this PR do not publish the website, spend Lovable AI credits, create users, or modify the production database.
