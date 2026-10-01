# KK Group ERP relationship model

The application is organized around one traceable chain:

```text
Company
├── Staff ── Roles ── Permissions
├── Projects ── Sites ── Buildings ── Floors ── Units
├── Vendors ── Vendor categories
├── Materials ── Item categories ── Units of measure
└── Warehouses ── Project/Site

Project requirement → Purchase request → Approval → RFQ
→ Vendor quotation → Selection reason → Purchase order
→ Approved GRN → Inventory ledger / weighted average stock
→ Material issue → Project/location/activity consumption
→ Project actual cost → Matched purchase invoice
→ Approved payment → Double-entry journal → Reports
```

## Phase boundaries

- Phase 1 implements identities, access, company, project/location, vendor, material, and warehouse masters.
- Phase 2 adds purchase requests, RFQs, quotations, comparisons, and purchase orders.
- Phase 3 adds approved receipts, immutable stock movements, balances, issues, transfers, returns, and weighted-average valuation.
- Phase 4 adds matched invoices, payables, approval thresholds, allocations, and payments.
- Phase 5 posts balanced journal entries and project cost summaries from approved source documents.
- Phase 6 adds compliance records, exports, notifications, and authenticated CRM integration endpoints.

Every transactional line will retain its source document, project, location, material/vendor, actor, approval, and timestamp. Approved records become immutable; corrections use reversals or explicit adjustment records.