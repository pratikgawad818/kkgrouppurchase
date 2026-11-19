# KK GROUP ERP

**Construction procurement, inventory, project operations and finance**

An internal web application for KK GROUP. This repository contains the application, database migration history, automated tests and operations documentation.

**Production application:** https://kkgrouppurchase.lovable.app  
**New maintainer:** Begin with the [handover guide](docs/HANDOVER.md).

## Documentation

| Read first | Purpose |
| --- | --- |
| [Maintainer handover](docs/HANDOVER.md) | System baseline, ownership transfer and signed acceptance checklist |
| [Developer guide](docs/developer-guide.md) | Architecture, source navigation and code-maintenance rules |
| [Operations runbook](docs/operations-runbook.md) | Release, backup, monitoring and incident procedures |
| [Access and security](docs/access-and-security.md) | Permission boundaries, credentials and successor account setup |
| [Documentation index](docs/README.md) | Detailed workflows and historical evidence |

## Business modules

- Projects, sites, buildings, floors and property units
- Purchase requests, RFQs, vendor quotations and purchase orders
- Vendor delivery challans, accepted goods receipts and stock registers
- Material issues, returns, transfers, reorder planning and project consumption
- Vendor invoices (including opening balances), advances, payments and small expenses
- Project cost reports, director approvals, staff permissions and notifications

**System of record:** Supabase/PostgreSQL. Business documents, stock movements and financial entries are linked by database foreign keys and audited transition functions. Google Sheets and WhatsApp ERP integrations were retired; they are not part of current operations.

## Local development

Requires Node.js 24 and Bun. Use the versions pinned in `bun.lock`.

~~~sh
git clone https://github.com/pratikgawad818/kkgrouppurchase.git
cd kkgrouppurchase
cp .env.example .env
# Configure the approved publishable Supabase values.
bun install --frozen-lockfile
bun run dev
~~~

Never put service-role keys, database passwords, SMTP passwords or private provider tokens in `.env` or source control. Only publishable browser configuration belongs in `VITE_*` variables.

## Verification

~~~sh
bun run check
bun run lint
~~~

`check` runs the environment guard, domain tests, application build and TypeScript check. `lint` is separate. GitHub Actions also verifies migration replay and transactional rules against disposable PostgreSQL environments. A successful CI run does not prove live credentials, publication state or production backup recoverability.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/routes/` | TanStack file-based routes and business screens |
| `src/components/erp/` | Shared operational components, forms and document tools |
| `src/components/ui/` | Reusable UI controls |
| `src/lib/` | Domain helpers, auth, formatting, preflight checks and calculations |
| `src/integrations/supabase/` | Client and authentication integrations |
| `drizzle/schema.ts`, `drizzle/migrations/` | SQL schema, ordered migrations and registry |
| `supabase/` | Project configuration and original foundation migrations |
| `scripts/tests/`, `scripts/db/` | Business regression and database verification |
| `docs/` | Maintainer documentation and historical release notes |

`src/routeTree.gen.ts` and Supabase type definitions are generated artifacts; modify their sources and use the appropriate generation process. **Do not rewrite applied migrations or production Git history.**

## Change management

Work on a branch, review the diff and tests, then use an approved PR. Syncing code to the connected hosting project, applying database migrations and publishing a production update are separate steps. Follow the [operations runbook](docs/operations-runbook.md) before making changes. During a handover, preserve all current application behavior and production records.
