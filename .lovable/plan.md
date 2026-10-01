# Complete Phase 1 as the procurement ERP foundation

## Goal
Convert the current sales-inventory foundation into the Phase 1 defined by the full internal ERP brief. Preserve the useful project/location hierarchy, but make procurement, inventory control, costing, and traceability the organizing model.

## Database design first
- Document the complete system relationship map before UI work: company and staff access; project/site/building/floor/unit locations; vendor and material masters; procurement documents; receipts and stock ledger; issues and project consumption; invoices and payments; double-entry accounting; documents, approvals, notifications, audit, and CRM integration references.
- Implement only the Phase 1 tables and shared foundations now:
  - vendors and vendor categories
  - item categories, materials, and units of measure
  - warehouses/stores linked to company and optionally project
  - project foundation fields needed by later costing and material flows
  - operational roles and granular permissions for Management, Purchase Manager, Store Manager, Accounts, Project Manager, Site Engineer, and Auditor
- Keep buildings, floors, and units as valid project consumption destinations. Remove their sales-centric prominence from the primary workflow.
- Add foreign keys, uniqueness and quantity/rate validation, indexes for list/search fields, explicit grants, row-level access, update timestamps, and immutable audit entries.
- Seed realistic, clearly marked Phase 1 data: 3 projects, 10 vendors, 30 materials across editable categories, and multiple central/project/site stores. Do not seed purchase requests, orders, receipts, invoices, payments, or stock movements before their phases.

## Phase 1 experience
- Replace the navy/brass sales look with the required compact blue-and-white enterprise design.
- Rebuild the desktop shell with a collapsible, remembered sidebar and mobile drawer. Show only working Phase 1 destinations: Dashboard, Inventory, Vendors, Projects, and Administration.
- Add a compact top bar with foundation-aware search, user/role display, notifications state, and settings. Do not expose Quick Add actions for modules that are not built.
- Build real, permission-aware CRUD screens for:
  - Projects, including project manager/site engineer, budget and estimated cost
  - Vendors and vendor categories
  - Materials and editable categories
  - Warehouses/stores and their project links
  - Users, role assignment, activation, project assignment, and the role-permission matrix
  - Company settings
- Keep project location pages available beneath Projects for later material-issue targeting, rather than presenting unit sales as a core module.
- Use compact searchable, sortable, paginated tables with sticky headers, filters, clear empty/loading/error states, and efficient data reads.
- Rework the dashboard to show only genuine Phase 1 figures from the database: active projects, active vendors, active materials, stores, low-stock thresholds/configuration readiness, and recent audited master-data changes. No procurement or financial totals before those workflows exist.

## Security and correctness
- Keep authentication and protected routes; make the first account Super Admin and later accounts inactive/awaiting assignment as appropriate.
- Enforce permissions in both the screens and database policies. Roles remain in a separate access table, never on a user profile or browser storage.
- Put privileged role/permission administration behind authenticated server-side validation.
- Ensure all master-data changes are audited and normal users cannot modify audit history.

## Verification and handoff
- Validate the build and inspect current diagnostics.
- Test the signed-in Phase 1 flow at desktop and mobile sizes: sign in, navigate, search/filter, and perform representative create/edit actions with permission-aware behavior.
- Review the final database structure and show the core workflow: configure company/access → create projects and locations → onboard vendors → define categories/materials → create project stores. Clearly state that procurement transactions begin in Phase 2.
