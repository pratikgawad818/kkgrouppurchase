# Building-wise material usage and physical balance (Phase 4)

The existing `record_material_issue` / `record_material_return` RPCs already
track material quantities to projects and optional buildings. This PR adds
a **material selection** to Project Consumption and a unified view showing:

- Issue quantity, returned quantity and net consumed for selected project and
  building, grouped by project/building.
- Current warehouse balance of the selected material, grouped by warehouse.
  This balance is **company-wide across RLS-accessible stores** even when
  consumption filters select a single project.
- Cost of net usage at historical issue cost, not invoice cash paid.
- Page-complete `project_material_consumption` RPC pagination (10k safety cap)
  and stock pagination with exact counts, fail closed on truncated queries.

Example: 700 bags originally stocked, 300 issued to Tower 1 and 230 to Tower 2
with 30 returned, results in 500 net consumed and, with no other movements,
200 bags available. If transfers, other purchases, returns or adjustments
occurred, the real on-hand balance reflects those independent movements.
Never label `net consumed + current stock` as total received without a full
movement reconciliation.

No changes to immutable MI/MR stock ledger, database migrations, live data,
pricing logic, or Lovable credits. Source-only until reviewed deployment.
