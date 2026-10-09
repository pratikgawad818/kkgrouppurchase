# KK GROUP ERP — Project Cost Control (lifetime operating indicators)

**Route:** `/reports/project-cost-control` (authenticated, `financial.view`).

This read-only dashboard compares **project budget baselines** against **separate** project procurement and operational measures, without posting accounting entries.

## Why four figures must NOT be added

| Measure | Source and inclusion | Exclusions / interpretation |
|---|---|---|
| **Project budget** | `projects.budget`, whole project, lifetime | Manually maintained baseline; zero means not yet set. Not restricted to a FY. |
| **Net recorded material consumption** | Database RPC `project_material_consumption(NULL)`: posted material issues less unused-material return credits, valued at original issue-time weighted-average cost | This is **operational material usage only**, not the full expense ledger, material procurement, land, labour, subcontracting or WIP. |
| **Open PO material line commitments¹** | `purchase_orders` with approved/sent/partial status; `sum(line_total × max(ordered - accepted - short_closed,0)/ordered)` | Undelivered material estimate. Excludes PO-level freight, charges and discounts. Not a creditor/payable balance. Quantity is accepted rather than physically received; rejected/damaged units are not accepted. |
| **Approved unpaid supplier bills²** | `vendor_invoices.balance_due` for status approved/partially_paid | Only approved payables; excludes draft/matching exceptions, paid and rejected. Payments follow the 3-director/recording workflow. |

**These measures overlap**: one batch of cement can be in an approved PO, then accepted into stock, then issued to a project, and invoiced and paid. **Never sum net consumption + PO value + invoice balance as “spent” or “budget consumed”.** For a complete project budget versus actual cost report, a later work-breakdown/GL-based cost ledger is required and must reconcile purchase invoices, WIP capitalization and labour contracts. This module does not invent such figures.

**Material-to-budget percentage** = `net recorded material consumption / project's full budget × 100` when budget > 0. This is a **partial, material-only ratio**, not total budget utilization, not available cash, and not remaining construction budget. Values above 100% show that material issued to the project **alone** has exceeded its recorded total budget baseline.

## Access and safety

- Main route and project budget queries require `financial.view`. The sidebar link is permission-gated.
- PO lines query only if `purchase_order.view` is available.
- Stock usage query only if `inventory.view` is available.
- Vendor invoices query only if `payable.view` is available.
- Missing permission or a failed query displays **—** (unavailable), never an invented zero. Existing Supabase RLS restricts project/company visibility independently.
- All reads use pre-existing tables and the pre-existing consumption RPC. No SQL migrations, RPC writes, stock mutations or vendor payment actions.
- PO and invoice queries page in batches of 500, up to 3,000 each and warn when the cap is reached. Consumption RPC is an existing server-returned aggregate; the UI warns if its row count reaches 1,000 and could be truncated by API limits.
- Project filter, status, sort and search are client-side, operate on already authorised rows. All amounts project-to-date.

## Validation

CI runs `scripts/tests/project-cost-control.test.mjs` with the same project summary module used by the UI, plus build/strict TypeScript and SQL grammar tests.

Unit tests cover: accepted minus short-closed PO quantity, invoices at approved/part-paid/paid stages, outstanding AP, rejecting exception/cancelled/draft bills, zero budget, negative net consumption reversal, project segregation and avoiding additive totals.

**Remaining manual acceptance:** authenticated preview at widths 375/768/1440, user-role RLS coverage, budget baseline completeness, example reconciliation with source records, currency rounding and performance once 3,000+ records exist. GitHub merge is not a Lovable production publish.
