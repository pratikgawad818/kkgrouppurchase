# Vendor delivery challan → Goods receipt → Inventory

This module records the supplier's **physical dispatch document** separately from the GRN. It does not create stock or accounting entries.

## Workflow

1. Three directors independently approve the commercial purchase order.
2. Buyer/store staff open PO → **Register vendor challan**, enter the vendor's actual challan number, date, vehicle reference and dispatched material quantities.
3. ERP stores a standalone challan header + immutable dispatch lines. PO, project, vendor and company are inherited from the PO; the vendor number must be unique per vendor and company.
4. On **Receive goods**, store staff select the registered challan. ERP shows the quantities remaining on that challan (after any prior, non-cancelled GRNs, including drafts).
5. Staff enter physically received, damaged and rejected quantities. The GRN stays draft or is posted using the existing audited GRN workflow.
6. The database checks PO line identity, challan identity, available challan quantity and existing PO reception limits **in one transaction**.
7. Only GRN posting adds accepted quantities to the immutable stock ledger.
8. Staff can cancel a challan only if no live GRN references it; cancellation needs an audit reason. GRN cancellation releases the associated dispatched quantity for later reuse.

Existing legacy GRNs remain visible with an unlinked text challan number. The five-argument `create_goods_receipt` supports a legacy **unlinked** receipt for controlled integrations; the new UI requires a registered challan. The deprecated **four-argument** RPC has its public/authenticated execute privilege revoked because it bypasses newer GRN guards. Before imposing a strict all-new-GRNs mandate at database level, ensure legacy API clients have migrated.

## Deployment and staging gates — DO NOT SKIP

- Approval migrations 0012 and 0013 and their financial tests must be applied before 0014.
- Do **not** assume GitHub merge or Lovable sync automatically applies Drizzle SQL. Apply 0014 in a **staging database** using an authorised migration process.
- Compare live schema to `src/integrations/supabase/types.ts` and refresh generated types after applying the migration.
- Confirm permissions `grn.view`, `grn.create`, `grn.post` and company+project RLS for authorised store/buyer roles.

### Staging test matrix

| Test | Expected |
|---|---|
| Draft/unapproved or cancelled PO | Registration rejected |
| Approved PO, one vendor challan with two material lines | Challan registered, no stock movement |
| Same vendor + same challan number | Duplicate rejected |
| Other vendor/PO material line | Registration rejected |
| Zero, negative, excessive or malformed quantity | Registration rejected |
| Different company user | Register, view and cancel denied |
| First GRN for one challan: dispatched 10, received 6, accepted 5, damaged 1 | Receipt succeeds; posted stock +5 |
| Second GRN for same challan: received 4 | Succeeds subject to remaining PO quantity |
| Third GRN requests more than challan quantity | Rejected |
| Two concurrent GRNs would exceed challan | At most one succeeds |
| Draft GRN reserves challan quantity; second GRN exceeds | Rejected |
| Cancel draft GRN | Releases reservation |
| Cancel posted GRN (when existing finance safeguards permit) | Stock reverses via existing compensating ledger, reservation releases |
| Cancel challan linked to draft or posted GRN | Rejected until linked GRNs cancelled |
| Cancel unused challan with reason | Cancel succeeds and audited |
| Re-register same vendor number after cancellation | Rejected (immutable document identity) |
| Receipt date before challan date | Rejected |
| Receiving warehouse from another company or unrelated project | Rejected |
| Multiple partial challans for same PO | Quantities tracked per challan, not pooled |
| PO closes after prior receipts | New GRNs cannot post |
| PO cancellation while registered challan exists | Blocked until supplier challan is cancelled |
| Deprecated four-argument GRN RPC through authenticated API | Permission denied |

**No production inventory posting until the actual database migration, RLS rules and transactional tests are verified.**
