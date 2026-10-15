# Inventory Stock + Payables responsiveness (source-only)

## Stock register
- Removed the dangerous silent `limit(2000)` on physical stock. Exact-count,
  deterministic `warehouse_id,material_id` paging validates every retrieved
  page and refuses a partial/unreliable rollup or more than 10,000 rows. If the
  browser safety limit is exceeded, error instructs use of a server-side report.
- The stock table now displays **25 lines at a time** instead of thousands
  of DOM rows, preserving complete filtered totals and searchable warehouses.
- Stock movements/postings still invalidate `["stock"]`. Warehouse and item
  selector catalogs use their own `["stock-catalog"]` with a 60-second
  freshness window so transfers do not reload unrelated master records.
- Catalogs are paged with exact counts; absent/failed pages fail closed rather
  than silently exclude stores or materials from a stock adjustment.
- New pure rollup tests exercise 2001 lines, value/low/out totals, filtering,
  and incomplete/capped page rejection.

## Accounts Payable
- Memoizes vendor/project/FY/due-date filtering and vendor totals. A single
  filter change updates the breakdown; routine rerenders and page navigation
  avoid rescanning all invoice rows.
- Replaces repeated array `includes()` membership checks with ID sets,
  preserving existing financial calculations, status rules and due-date logic.
- Clamps display page when filters shrink a result set.

## Boundaries
No accounting formulas changed, no financial posting, RLS grants, DB
migrations, Lovable credits, production data writes or Publish actions.
This is static/integration test verified only: browser waterfall and
real-world device latency still require an authenticated staging session.
