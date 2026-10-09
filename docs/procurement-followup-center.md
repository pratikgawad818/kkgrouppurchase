# KK GROUP ERP — Procurement Follow-up Center

Route: `/procurement/follow-ups` (authenticated).

## Builder's daily workflow

The follow-up center is designed for purchase managers, site engineers, and accounts teams coordinating several construction projects and suppliers. It is **read-only**; clicking a document opens its existing authorised workflow.

1. **POs awaiting director approval** — open the purchase order and get the required three independent decisions. This screen cannot approve anything itself.
2. **Overdue supplier deliveries** — investigate the vendor and confirm a revised dispatch plan. A PO appears if an open accepted-material commitment has an expected date earlier than the current Indian date.
3. **Due in the next seven days** — confirm delivery slot, site readiness and receipt personnel with vendors.
4. **Missing expected delivery dates** — open the PO to record realistic terms. A missing date is not automatically classified as late.
5. **Invoice matching exceptions** — open the vendor invoice, review PO/GRN/quantity/rate/tax differences, and re-run the existing approval workflow. An unmatched bill is not automatically payable.
6. **Overdue approved vendor bills** — only approved or partially paid invoices with positive outstanding balances and a past due date. Follow the existing payment approval and recording controls.

Project, supplier, financial year and keyword filters apply to the displayed counts and lists. The dashboard surfaces the first 2,000 latest open records of each document class and warns if there are more; such figures should not be treated as complete at that scale.

## Financial and stock definitions

- **Open material line value¹:** `sum(line_total × max(0, ordered − accepted − short_closed) / ordered)`. This is approximate: it excludes unallocated PO-level freight, miscellaneous charges and discounts; it is **not** a creditor balance or invoice amount.
- **Accepted percentage²:** `sum(accepted line value) / sum(line value attributable to commitment after short-closing)`; capped between 0 and 100%.
- `received_quantity` can include damaged/rejected quantities, so it is never used as accepted material in this report.
- GRN posting, short-closing, vendor invoicing, and payment recording are not performed by this dashboard.
- **Overdue payables:** sum of `balance_due` for invoices with status `approved` or `partially_paid` and `due_date < today` (in IST), excluding exception and pending-review bills.
- An invoice match exception is signalled by active `status='exception'` or `match_status='exception'`. Cancelled/paid/rejected invoices are excluded.

## Security and quality

Existing company/project Supabase RLS and role permissions govern which records are returned. Each source query is enabled only when the user has a corresponding viewing permission. No new SQL, migrations, or write APIs were added.

Automated tests in `scripts/tests/procurement-followup.test.mjs` cover quantity valuation, short-close behavior, calendar boundary dates, urgency, inactive PO statuses, and invoice status exclusions. The CI workflow runs them with Node 24 before the app build and TypeScript check.

### Remaining acceptance checks

- Open the authenticated page on MacBook and mobile (375px and 768px widths).
- Confirm multi-project role scoping with site-engineer, buyer and Accounts login.
- Confirm links resolve to the correct documents and open value reconciles to accepted/short-closed quantities.
- Confirm an unusually large dataset (>2,000 active POs/invoices) shows the visible cap warning.
- Confirm route appears in authorised navigation after updating/publishing the frontend.
