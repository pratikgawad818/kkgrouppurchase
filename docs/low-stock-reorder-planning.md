# KK GROUP ERP — Low Stock & Reorder Planning

**Route:** `/inventory/reorder-planning` (authenticated, `inventory.view` required).

## Intended workflow for construction-site purchasing

The planner highlights existing project/site store stock balances that meet a configured material reorder threshold. It cross-checks outstanding quantities on approved, sent, or partially received purchase orders **only for the matching destination warehouse**, to reduce accidental duplicate purchases.

This is **read-only planning intelligence**. It never inserts purchase requests, purchase orders, warehouse transfers, stock postings, reservations, or financial entries. A permitted user can navigate to the existing purchase request form **without any prefilled values**; they must check open PRs/POs, site demand, vendor prices and alternate company warehouses before submission.

### Calculation and guardrails

- Each active material has one set of `minimum_stock`, `reorder_level` and optional `maximum_stock`. Existing schema does **not** provide per-warehouse threshold configuration. Trigger threshold is `max(minimum_stock, reorder_level)`.
- A site is monitored if an **explicit warehouse_stock row** exists for its material, or a qualifying open PO explicitly names that site as its `delivery_warehouse_id`. Do not assume every active material needs stocking in every warehouse.
- A material master with a threshold but no visible store record is listed separately as **not assigned to a visible warehouse**. This is not automatically a zero-stock alarm for every site.
- Unconfigured minimum/reorder/maximum levels cannot create a reliable alert. The planner counts such stock lines and links to Materials to configure policy.
- Incoming outstanding quantity: `max(0, ordered_quantity - accepted_quantity - short_closed_quantity)` for each qualifying PO line. Never use gross received quantity, which can include rejected/damaged materials. POs in draft, pending approval, rejected, cancelled, fully received, closed, or short-closed are not treated as incoming.
- A PO **without a visible active warehouse destination** is flagged for allocation and **never counted against a specific store's projected stock**.
- `projectedIfDelivered = max(0, onHand) + incoming`. This is **not on-hand stock**. A pending PO is not guaranteed to arrive on time or be accepted; past-due and undated PO commitments are explicitly flagged.
- If actual stock is at/below trigger and projected stock with incoming is higher than trigger, mark **Incoming may cover**. In that situation the planner suggests **no additional reorder quantity**, preventing duplicate buying based solely on stock count.
- If the site is still at/below trigger after incoming and a valid `maximum_stock > trigger` exists, provisional `topUpToTarget = max(0, maximum_stock - projectedIfDelivered)`. Without a configured target, show **Review needed**, not a fabricated order quantity.
- If the authenticated user cannot see the complete PO queue (missing `purchase_order.view`, query failure, or retrieval cap), all suggested top-up quantities become **unavailable**. Do not assume outstanding orders are zero.
- Each source uses explicit PostgREST offset pagination in 400-record pages to avoid the default 1,000-record cap. At 3,200 records per source, the screen warns its conclusions may be incomplete. Material master/store access remains subject to original RLS and role grants.
- `inventory.view` can see stock and the page. `materials.view` expands to stockless configured materials. `purchase_order.view` is required for inbound quantity and PO links. `purchase_request.create` is required for the New Purchase Request button. Database RLS is independently enforced.

### Status meanings

- **Out of stock:** on-hand stock is zero or negative now, even when future POs exist. A site must confirm whether urgent transfers, alternate supply or expedited delivery is required.
- **Reorder review:** available on-hand stock is at/below trigger and committed incoming is not enough to raise projected stock above trigger.
- **Incoming may cover:** planned incoming quantity would move projected stock above trigger. This is conditional on arrival, not stock availability.

## Verification

`scripts/tests/reorder-planning.test.mjs` covers warehouse isolation, PR/PO duplication safeguards, incoming allocation, damaged/short-closed PO lines, first-time stock locations, missing threshold policy, disabled/hidden PO information, zero stock, overdue/undated delivery notes, and inactive stores/materials.

GitHub CI also runs production build, TypeScript, and existing business-rule tests. Manual acceptance of authenticated desktop/mobile layout, RLS combinations, outstanding PO reconciliation, and >3,200-record reporting is still required. Do **not** claim live publishing just because GitHub merges or Lovable syncs.

**No Lovable AI credits, no database migration, and no stock mutations are necessary for this phase.**
