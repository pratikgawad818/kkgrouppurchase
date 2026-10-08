# KK GROUP ERP — Material Issues, Returns & Project Consumption

## Purpose

Track **when store materials are consumed by a project** and any **unused quantities returned to the original store**. Supplier GRN posting adds stock; warehouse transfers only move stock between stores; material issues remove usable stock and attribute the cost to specific project/building works. Return documents restore usable stock and credit that project's consumption.

**Do not double count purchases and issues as two cash payments or AP invoices.** This is an operational material consumption metric; integrating it with construction WIP / general ledger expense recognition is a separate accounting decision.

## Workflow

1. Posted GRNs, opening stock, or transfers create available store stock.
2. From **Materials & Stores → Material Issues & Returns**, staff choose project, optional building, original store, recipient and work purpose.
3. Enter a positive quantity for one or more store materials. The database validates the user, company, project, building, stock, active material and quantity in one transaction.
4. ERP creates immutable `MI-YYYY-NNNN` source document, immutable issue lines and append-only `material_issue` ledger rows. Stock decreases at its then-current weighted-average cost.
5. For unused materials, open the original issue and select **Return unused materials**. The return always credits the original issue's project/building and puts units back in its original store.
6. ERP validates cumulative returns (across all return documents) cannot exceed the original issue line, even with concurrent calls. It creates `MR-YYYY-NNNN` with source-linked `material_return` ledger rows.
7. **Project Consumption** runs a database-side grouped report of issues less returns, by project/building/material, using issue-time valuation rather than purchase-invoice totals.

## Controls

- All writes only through `record_material_issue` and `record_material_return` SECURITY DEFINER RPCs.
- `post_material_stock` is private and only callable by those audited database functions.
- All source documents and issue/return lines have immutable triggers; stock ledger has no client write grants.
- Project/building and store-company alignment is validated by the database; source warehouse project assignment must be compatible.
- Material issue quantities cannot exceed on-hand warehouse stock. Multi-line postings roll back atomically if any line fails.
- Return quantities are bounded by the original issued amount and serialized by locking the original issue line.
- Issue consumption is a stock movement, not a cash payment; no bank/AP journal is posted by this migration.
- Material returns are valued at the **original issue cost**. Current warehouse weighted-average stock valuation is recalculated when the returned units re-enter.
- User inputs identify personnel (recipient, returner), never substitute for authenticated user IDs: `created_by` is derived from `auth.uid()`.

## Before deployment (staging only)

1. Confirm migrations 0012, 0013 and 0014 (approvals/challans) have been applied as appropriate; merging GitHub code does not prove Supabase schema deployment.
2. Apply migration `0015_project_material_issues_returns.sql` to **staging**, inspect schema grants and RLS.
3. Verify automated build and strict TypeScript check pass, including generated TanStack Router routes.
4. With a registered GRN and warehouse stock, post MI of 10 units to Project A, Building 1. Stock should decrease by 10, one stock-ledger row and one issue document should be created; consumption should show issue cost.
5. Return 4 units on MR. Stock should increase by 4, issue detail should show 6 net units consumed, consumption should subtract original cost of the 4 units.
6. Return remaining 6 units in a second MR. Third attempt must be rejected. Attempting two concurrent returns that exceed original quantity must result in at most one success.
7. Try issuing more stock than exists; negative, zero, excessive-decimal or duplicate material entries. No partial stock or documents should persist after any exception.
8. Try creating issue with a different-company warehouse, another-project store, or a building from another project. Reject all.
9. Check unauthorized roles cannot call RPC or see another company's project issues/returns.
10. Verify issue/return header, lines and audit history cannot be updated or deleted by normal clients.
11. Issue material at one average cost, then have other GRNs change the store's average and return unused material. Consumption should still credit the **original issue cost**, while stock average is updated according to the weighted average formula.
12. Verify the ledger entry links to original MI/MR and `material_consumption` shows correct project, building and material.
13. Check existing GRN, warehouse transfer, stock adjustment and payment modules still behave identically.
14. Test real store staff roles (`inventory.issue`, `inventory.return`, `inventory.view`) and representative mobile display before production approval.

**Release gate:** database transactional tests on staging, permission/RLS validation and authorised rollout review. Code merge or GitHub CI alone is not sufficient for real inventory processing.
