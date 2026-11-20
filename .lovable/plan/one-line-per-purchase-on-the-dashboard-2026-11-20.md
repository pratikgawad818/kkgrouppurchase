# One line per purchase on the dashboard

## Problem
The dashboard lists every document on its own: PR-2026-0004, RFQ-2026-0005 and PO-2026-0003 show as 3 rows, even though they are all for the same Speed Breaker purchase. Later the challan, goods receipt, invoice and payment would add even more rows for it.

## What you will see
Each purchase gets one row, starting from its purchase request:

```text
Speed Breaker - Main Road · KK Park                      Due 22 Nov
[PR-0004 ✓] > [RFQ-0005 ✓] > [PO-0003 AXNOY] > Challan/GRN > Invoice > Payment
Now: Order approved — waiting for delivery              [View order >]
```

- Finished steps get a tick. The current step is highlighted. Later steps are greyed out.
- Tap any document number to open that document.
- The "Now" line says what is waiting, and the button opens the document that needs action.
- When the challan, GRN, invoice or payment arrives, the same row moves forward. No new row is added.
- Once the purchase is fully paid, or cancelled or closed, the row drops off the dashboard. It stays in the registers.
- One request split into several orders or vendors: you get one row per order, and each row shows the same PR and RFQ at the start.
- Old bills with no order, or anything else with no request, still show as a row of its own.
- The Purchasing / Payments tabs and their counts will count purchases, not documents.

## Stages (in order)
1. Request: draft or waiting for approval
2. RFQ: quotations being collected, or ready for an order
3. Order: draft, waiting for director approval, or approved/sent
4. Delivery: challan or goods receipt recorded, part or full
5. Invoice: entered, being matched, exception, or approved
6. Payment: scheduled, approved or part paid
7. Done: fully paid (hidden)

## Not changing
No changes to approvals, statuses, permissions, money or stock. This only changes how existing records are grouped and shown. Everyone still sees only the projects and modules they already have access to.

## Technical details
- New `src/lib/purchase-pipeline.ts`: pure function that groups PR, RFQ, PO, challan, GRN, invoice and payment rows into chains using the existing links (rfq.purchase_request_id, po.purchase_request_id/rfq_id, challan/GRN/invoice.po_id, payment allocations to invoice). It works out the current stage, label, action and due date.
- Dashboard query loads the open rows for each document type plus their link columns (still subject to RLS and page permissions), then builds chains on the client.
- `daily-workspace.tsx` row becomes a chain row with step pills; it stays responsive (pills wrap or scroll on mobile).
- Vitest unit tests for grouping and stage selection, covering PR→RFQ→PO collapsing into one row, a GRN moving the stage forward, a paid chain being hidden, and the one-request-several-orders case.
- No database migration.
