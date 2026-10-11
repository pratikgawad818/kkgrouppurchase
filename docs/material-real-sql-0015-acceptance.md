# Material issue and return SQL acceptance — isolated PostgreSQL

This automated acceptance gate installs the **actual** `0015_project_material_issues_returns.sql`
against a synthetic schema and warehouse opening balances. It proves the
material-issue and material-return RPCs, source links, weighted average cost
updates, project/building consumption aggregation and immutable record checks
work together **on disposable PostgreSQL**.

## Cement example

Initial stock is *synthetically seeded* as 700 bags at ₹300 per bag.
The test posts two **real** material issue RPCs: 300 bags to Tower A and 230
to Tower B; then a **real** linked return RPC of 30 bags from Tower B.

Expected: 530 issued − 30 returned = 500 net consumed, physical balance 200,
₹150,000 net material usage, three transaction ledger entries from issue/return,
and one synthetic opening-stock ledger entry. The test also checks insufficient
stock, too-large returns, invalid building/project/store combinations,
immovable source documents, read-only management access, and tenant isolation.

The fixture intentionally supplies **minimal simulated dependencies** such as
`next_doc_number`, `log_event`, role rights and initial warehouse inventory.
It **does not** install the actual `0001` goods receipt code or claim end-to-end
GRN → warehouse → issue → return acceptance. That requires a separate staged
integration test or safely backed-up isolated staging project. It does **not**
exercise a browser, PDF, supplier payment, or actual customer business records.

Do not apply this CI fixture to any real Supabase environment. The test
refuses non-`material_qa` databases and requires `CI=true`.
No Lovable credits, persistent staging project, live migrations or production
publishing are involved.
