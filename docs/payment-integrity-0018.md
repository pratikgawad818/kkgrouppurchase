# KK GROUP ERP — Proposed vendor payment integrity migration 0018

**Status: PROPOSED SOURCE MIGRATION ONLY. NOT INSTALLED IN LIVE LOVABLE CLOUD.**

The earlier migration 0017 is live and protects accepted GRN invoice quantities. This proposal addresses the **next** stage of the builders' purchase-to-payment cycle: scheduling and recording vendor payments.

## Findings in currently deployed server functions

- `schedule_vendor_payment` checks each invoice allocation separately. If a direct RPC call lists the **same invoice twice**, both amounts can individually pass against the same available balance; combined scheduled allocations can exceed the invoice.
- The `SECURITY DEFINER` scheduling function checks the caller's permission but **does not compare their company with the selected vendor, project or bank account**.
- `payment_transition` checks a general action permission but, for record/cancel, **does not explicitly check the caller's company or project** before mutating a supplied payment UUID.
- The browser UI now checks payment reservations and shows errors (merged PR #22), but the server must enforce these invariants even if a malicious/old client bypasses the UI.

## Proposed database changes

1. Refuse repeated `invoice_id` in a single scheduled payment payload.
2. Add a unique index on `(payment_id, invoice_id)` to prevent duplicate allocations through other code paths; reject invalid (non-positive or >2-decimal) monetary allocations.
3. Require the actor to be an active profile **within the vendor/payment's company** for both scheduling and status transitions.
4. Reject invoices outside the caller's accessible projects, outside the selected vendor, or outside the same company.
5. Validate the optional project and company bank account belong to the vendor's company, and require the bank account to be active.
6. Continue locking approved vendor invoice rows `FOR UPDATE` while checking already scheduled/approved allocations to serialize simultaneous bookings.
7. Preserve existing three-director approval rules, recorded-payment journal postings, allocation balance refresh, and payment event logging.

## Rollout limitations

- GitHub merge does not apply SQL. The source migration is **not a deployment authorisation**.
- The connected Lovable database currently has **no active directors**, so the live approval/payment workflow cannot be completed until three active director accounts are configured.
- There are currently **zero vendor payments and allocations** in the live database. Nevertheless, take a fresh backup and rerun preflight checks before deployment.
- A staging PostgreSQL suite in `scripts/db/test_payment_0018_integrity.py` uses `scripts/db/fixtures/payment_0018_disposable.sql` and validates duplicate invoice allocations, cross-company accounts, project scope, invalid amounts, payment actions, and two concurrent schedulers attempting to reserve beyond the same invoice's balance.
- A synthetic fixture does not fully exercise company RLS, all finance journal postings, bank connector effects, or real director identities. Manual UAT with the three actual director accounts and production-like finance configuration remains necessary.
- Do not apply migration 0018, change existing records, send any WhatsApp messages, publish, or spend Lovable AI credits without separate user permission.

## Deployment acceptance checklist

Obtain management approval for strict payment integrity, take a restorable backup, verify migration 0017 is installed and 0018 is absent, run a read-only audit for duplicate allocations and cross-company mismatches, complete CI and staging tests, then deploy the SQL and register migration 0018 in one transaction. Independently verify new functions, constraint/index and unchanged financial data counts afterward.
