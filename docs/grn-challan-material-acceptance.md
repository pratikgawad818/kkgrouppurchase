# GRN → Building Consumption — PostgreSQL Acceptance

**Source-only, disposable PostgreSQL CI; no live Supabase or Lovable actions.**

The new test starts with **zero stock**, creates a synthetic *approved* PO
for 700 cement bags and executes the actual stored procedures extracted from:

- `0014_vendor_delivery_challans.sql`: register supplier delivery challan
  and validate/record a linked goods receipt.
- `0003_phase4_completion.sql`: apply GRN to stock via post_stock_x.
- `0015_project_material_issues_returns.sql`: issue and return materials,
  update the ledger and report consumption by project/building.

The fixture synthesizes the prerequisite schema, roles, PO, and vendor.
**It does not install the whole 0000–0014 migration chain**; therefore this
cannot certify a full production schema migration or realistic authenticated
web app. The body of each of the four receiving/stock functions above is
read directly from the committed migration file at runtime, not copied into
the fixture. The 0015 migration itself is executed unchanged.

### Acceptance sequence

1. Empty warehouse and no stock-ledger entries.
2. Supplier challan for 700 bags, **no stock movement** yet.
3. GRN for that challan posts 700 accepted bags to warehouse at ₹300/bag.
4. Issue 300 to Tower A and 230 to Tower B.
5. Return 30 unused bags from Tower B.
6. Assert **500 net bags consumed**, **200 bags in store**, ₹150,000
   allocated consumption cost, four source-linked stock-ledger entries.
7. Reject cross-company/wrong-store GRN, over-challan quantity, duplicate
   receipt, over-issue and over-return. Check separate company's visibility.

The original 0015 opening-balance test remains, independently safeguarding
the issue/return routine. **CI pass ≠ live deployment or browser acceptance.**
Do not run this fixture against a real project or use its dummy IDs as actual
business data.
