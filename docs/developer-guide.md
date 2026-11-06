# Developer guide

This guide explains the current source layout and the boundaries that must be preserved when maintaining KK GROUP ERP. For transfer and acceptance, start with [HANDOVER.md](HANDOVER.md). For deployment and incident procedures, read [operations-runbook.md](operations-runbook.md).

## Stack and local setup

| Layer | Implementation | Maintainer entry point |
| --- | --- | --- |
| Application | TypeScript, React 19, TanStack Start/Router, Vite | `src/routes/__root.tsx`, `src/routes/` |
| Data fetching | Supabase client and TanStack Query | `src/integrations/supabase/client.ts`, `src/lib/session.ts` |
| Data store | PostgreSQL/Supabase with row-level security | `drizzle/schema.ts`, `drizzle/migrations/` |
| Domain transactions | Database RPC functions with audited source records | Numbered migrations; calls from route modules |
| Components | React and shared UI/ERP components | `src/components/erp/`, `src/components/ui/` |
| Validation | Node tests, TypeScript, build, disposable PostgreSQL suites | `scripts/tests/`, `scripts/db/`, `.github/workflows/verify-erp-pr.yml` |

Use Node.js 24 and Bun; do not substitute package versions without testing the dependency lockfile.

~~~sh
git clone https://github.com/pratikgawad818/kkgrouppurchase.git
cd kkgrouppurchase
cp .env.example .env
# Supply the approved publishable Supabase values in .env.
bun install --frozen-lockfile
bun run dev
~~~

**No production key or private secret should appear in a VITE_ variable or be committed.** See [access-and-security.md](access-and-security.md).

### Verification before committing

~~~sh
bun run check
bun run lint
~~~

`check` performs the public-environment guard, domain tests, Vite build and strict TypeScript check. `lint` is a separate command; do not claim that `check` runs it. GitHub CI includes additional PostgreSQL tests against disposable databases; inspect workflow results rather than assuming a local pass covers production.

## Repository structure

~~~text
src/
  routes/
    __root.tsx                   Root providers, application layout
    auth.tsx                     Staff sign-in
    reset-password.tsx           Password recovery
    _authenticated/              Session-protected routes
      _shell/                    Business pages grouped by module
    api/                         Server endpoints
    lovable/                     Current provider-backed integration routes
  components/
    erp/                         Shared business tables, forms, dialogs, viewers
    ui/                          Low-level UI controls
  lib/
    session.ts                   Current profile, roles and permissions
    page-access.ts               Route permission mapping
    admin.functions.ts           Staff and administrator server operations
    purchasing-authority.ts      Purchase and approval policies
    pr.ts, rfq.ts, po.ts          Domain status/format helpers
    finance.ts                   Invoice, payment, file helpers
    invoice-preflight.ts         Invoice matching checks
    invoice-roundoff.ts          Optional accounting round-off
    material-usage-tracker.ts    Issue/return consumption calculations
    project-cost-control.ts      Project reporting calculations
    stock-register.ts            Stock register read models
  integrations/supabase/         Browser/server client and generated types
drizzle/
  schema.ts                      Schema definitions
  migrations/                    Historical, ordered SQL changes
  migrations/meta/               Migration registry and snapshots
supabase/
  migrations/                    Original foundation migrations
scripts/
  tests/                         Unit/domain regression tests
  db/                            Database preflights and disposable SQL tests
docs/
  archive/                       Dated incidents and historical decisions
.github/workflows/               Release verification
~~~

`src/routeTree.gen.ts` and `src/integrations/supabase/types.ts` are generated outputs. Edit their inputs or run the correct generation process; do not hand-edit generated route trees. Keep generated types aligned with the actual database and checked-in migrations.

Do **not** delete older SQL migrations or snapshots because their filenames look obsolete. Those files allow clean migration replay and support audit/transaction regression tests.

## How a normal request moves through the system

1. The authenticated route validates the user session, selected project and route permission.
2. `useMe()` obtains the profile and current privileges from `ensure_profile`, `my_permissions` and role assignments. Frontend visibility is a usability feature, not the security boundary.
3. The page loads authorized rows through Supabase with database RLS filtering. Shared form components render and validate user input.
4. A business-critical state change invokes the appropriate PostgreSQL RPC. Do not bypass it with direct `UPDATE` calls to transaction or ledger tables.
5. The SQL function checks company, project, roles, source quantities, document state and concurrency, then writes the linked document, ledger/audit rows and resulting state atomically.
6. The frontend invalidates relevant TanStack Query keys and displays updated status.

### Key business invariants

| Area | Required rule | Primary database/API boundary |
| --- | --- | --- |
| Purchase requests | Draft edits only; state changes auditable | `pr_transition` |
| RFQs and quotations | Preserve original PR, quotation and selection rationale | `rfq_transition`, `record_vendor_selection` |
| Purchase orders | Created through selected quotation; controlled approval | `create_po_from_selection`, `po_transition` |
| Challans and GRNs | Challan is evidence of delivery; **posted accepted GRN** affects stock | `register_vendor_delivery_challan`, `post_goods_receipt`, `cancel_goods_receipt` |
| Material movement | Append-only stock ledger, project/building attribution and checked returns | `record_material_issue`, `record_material_return`, inventory transaction functions |
| Supplier invoices | Match purchase and accepted receipt; opening bills are a separate supported path | `save_vendor_invoice`, `invoice_transition` |
| Payments / advances | Prevent duplicated settlement and post balanced accounting entries | `schedule_vendor_payment`, `payment_transition`, `apply_vendor_advance` |
| Permissions | Company membership + active profile + role/project scope | RLS and SECURITY DEFINER function guards |

Read the relevant SQL function definition **in the current migration chain** when changing its caller. A helper name in TypeScript does not guarantee a database permission rule. Prefer a forward-only migration, a transaction-level test and a current policy document when requirements change.

### Finance and inventory distinctions

- A PO is a commitment, not a payment.
- A received challan is not a posted GRN and must not increase warehouse stock.
- Accepted GRN quantity determines stock availability; physically received, damaged and rejected quantities are tracked separately.
- Issuing material deducts stock and attributes operational consumption; returning unused material reverses the related consumption at the original issue cost.
- An invoice creates a supplier liability only through its controlled approval/posting path; payment recording is a separate event.
- Material consumption, PO commitments and unpaid invoices can represent the **same economic item** at different stages. Never add them into a single total called project expenditure without accounting reconciliation.
- Old/opening vendor invoices and historical payments use their designated UI/SQL path; preserve reconciliation and audit history.

## Adding or editing a page

1. Identify the responsible route under `src/routes/_authenticated/_shell/` and its shared components.
2. Verify the route is in the central permission map `src/lib/page-access.ts`.
3. Reuse existing queries/components/formatting helpers rather than copying business logic into the page.
4. Validate company/project boundaries and document state in the database, not only with hidden buttons.
5. Add focused domain tests in `scripts/tests/`; if changing SQL permissions or ledger behavior, add disposable PostgreSQL coverage.
6. Run `bun run check` and `bun run lint`; review resulting diff for unrelated formatting or generated-file changes.
7. Open a PR, obtain review, and follow the operations runbook for publish/migration sequencing.

## Commenting and maintenance standards

- Use business-purpose comments: explain **why** a rule is necessary (approval separation, stock valuation, accounting precision, security or retries), not what a straightforward line of TypeScript does.
- Prefer self-explanatory names, short functions and explicit types. Avoid speculative TODOs or subjective claims.
- Keep comments near the rule they explain, and update tests/documentation when the rule changes.
- Preserve provider-specific folders and packages if the running application depends on them. Deleting integration files to hide their origin is not a safe cleanup.
- Do not mass-format or refactor a working production module during a handover. Structural refactors belong in a separate reviewed, regression-tested change.

## Useful references

- [Application data model](erp-data-model.md)
- [Role-based access](role-based-page-access.md)
- [Purchasing authority](purchasing-authority.md)
- [Material issues and returns](material-issues-returns.md)
- [Project cost control](project-cost-control.md)
- [Vendor delivery challans](vendor-delivery-challans.md)
- [Invoice preflight](vendor-invoice-preflight.md)
- [Payments integrity](payment-integrity-0018.md)
