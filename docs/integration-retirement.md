# Integration removal and repository cleanup

## App behavior

The app no longer contains WhatsApp settings, manual message buttons, message
draft builders, consent forms, automatic sender routes, or Meta credentials and
delivery helpers. Director approvals still use the existing authenticated
`po_transition` and `payment_transition` functions. Supplier contact details,
purchase documents, printable POs and the Follow-up Center remain available.
The installable app manifest, profiles, in-app notifications and browser alerts
are preserved.

## Database retirement

Migration `0030_retire_whatsapp_integration.sql` removes the old integration
triggers and public RPCs. It moves eight integration tables, when present, to
`retired_integrations`, revokes app/service access, and retains their audit rows.
It does not delete accounts, contact numbers, purchasing records, votes, stock,
invoices or payment records. The archive schema must not be exposed through
Supabase's API settings.

Original migrations 0022/0024 and their historical snapshots remain unchanged.
Removing or rewriting previously applied migrations would break database replay
and migration hash verification. The two historical database tests now also
apply 0030 and verify retirement, audit preservation and unchanged business
functions/triggers. These are migration regression fixtures, not active senders.

Before deployment:

1. Identify the actual deployment and database, inspect the applied migration
   ledger, and take a restorable backup.
2. Disable any privately configured external sender schedule. Deploy the app
   change that removes its API route and UI.
3. Apply all verified prerequisite migrations in order, then 0030, using the
   normal staging and production migration process. Test approvals and in-app
   notifications with separate accounts before signing off the live release.
4. Remove unused private `KK_WHATSAPP_TEST_*`, `KK_DIRECTOR_WA_*` and public
   `VITE_DIRECTOR_WA_*` deployment variables. Revoke integration-specific
   provider tokens only after checking they have no other consumers. Keep
   general Supabase credentials required by the ERP.

This source change does not cancel subscriptions or change the user's personal
WhatsApp Business app, Meta accounts, Kapso account or phone-number registration.
Those are separate provider-account operations. No production migration or
provider action is performed by the cleanup PR.

## Repository organization

Removed unused UI primitives, their unused mobile hook, obsolete brand asset
references, the unused OAuth/cron scaffolding and related dependencies. Only
the currently referenced full logo metadata and public app icons remain.
Framework peer dependencies are retained even when framework-generated entries
load them indirectly. Build-only dependencies are grouped in devDependencies;
`bun.lock` remains the authoritative dependency lockfile.

README now describes the current ERP instead of the obsolete Phase 1 template.
`docs/README.md` indexes current workflows, operations and database documentation;
dated investigations live under `docs/archive/`. Internal Lovable project
metadata, foundation migrations and original planning history are retained.

## Verification

Run `bun run check`. GitHub additionally executes actual migrations on disposable
PostgreSQL databases, including 0030 with the prior supplier and director
fixtures. The retirement tests compare audit row counts, verify no public
integration RPC or queue trigger survives, deny archive access to browser and
service roles, and preserve the identities of business functions and unrelated
triggers. Apply 0030 twice in QA to verify repeatability.

An anonymous local browser check verifies the login page, installable manifest
and 404 handling for the removed settings/sender routes. Authenticated business
workflows and provider/deployment settings still require access to the intended
environment; build results alone do not establish their state.
