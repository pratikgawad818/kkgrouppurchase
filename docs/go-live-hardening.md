# Go-live hardening release — 16 October 2026

This release repairs the code findings from the readiness audit. It includes the
previously pending removal of estimated purchase-request prices, transactional
PR/RFQ saving, document-scoped staff names, scoped notifications, safer push
delivery, confirmed recovery-email changes and complete dashboard paging.

## Database changes

Apply **0035 → 0040**, in order, through the existing reviewed migration process.
Old applied migrations remain unchanged. The receipt table makes retrying the
same save safe; a failed save rolls back the header, line replacement and status
transition together. Existing drafts reject stale edits using updated_at.
RFQ lines are copied from the approved request in the same transaction as its
supplier invitations.

Actor-name lookups return only actor ID and name for readable documents. They do
not grant access to staff profiles, email, phone, DOB or private role information.
The current policy remains **one independent active company Director** for a PO
or payment; self-approval is refused. Complete function definitions replace the
old string-patching approach. New approval cycles clear old attribution.

Approval notifications respect company, project assignment and active status.
PO/payment alerts link to the exact approval document. Payment status alerts are
restored after the retired integration's removal. Approval reminders are limited
to one per document every 15 minutes and retain an audit event.

Push registration is active-user-only, capped at ten devices and restricted to
supported provider destinations. Raw subscription insertion/updating is denied;
the sender independently validates existing rows, rejects redirects and times out
delivery. Notification updates permit only is_read. Provider responses and private
configuration are not logged. Failed dispatches return a non-success HTTP status;
operational alerting/retry ownership must still be configured in the hosting layer.

Email attachment uses the normal user-authenticated confirmation endpoint rather
than force-confirming addresses with an admin key. Profiles synchronize only when
Auth actually changes a confirmed address. Verify email delivery and the provider's
secure-email-change policy in staging. A username-only account may need
administrator assistance if that policy also requires confirming the old,
non-deliverable address. Never disable email security globally to bypass that.

## Test evidence

- The local check runs domain tests, a production build and TypeScript.
- The PostgreSQL hardening suite replays all seven foundation migrations and
  every numbered migration through 0040 against fresh synthetic data. Supabase
  Auth/Storage infrastructure is represented by fixtures; pg_net transport is an
  explicit HTTP spy, so this test sends no messages.
- It exercises failed-line and failed-submit rollback, stale edit rejection,
  duplicate retry tokens, simultaneous saves, foreign suppliers, cross-company
  actor lookup, inactive accounts, one independent director, self-approval refusal,
  scoped recipients and reminder throttling.
- A real advance-payment transition posts the actual balanced journal once,
  requires a bank reference and refuses a second recording. The journal is not a
  spy in this suite. Separate existing suites cover invoice allocation and GRN
  concurrency; this is not a complete physical delivery/bank reconciliation test.
- CI runs this full suite on PostgreSQL 17. Historical migration suites remain as
  regression tests for the earlier policies, not acceptance of the current rule.
- The vulnerable transitive esbuild tool is pinned to the already-used 0.25.12
  version; the updated lockfile's registry audit returned no advisories locally.

Run the new SQL suite only with CI=true and HARDENING_QA_DSN pointing at the exact
disposable database name hardening_qa. It refuses any other database name. It
creates its schema/roles and therefore requires a fresh isolated PostgreSQL
instance, not an existing production cluster.

## Rollout and remaining acceptance

1. Take a verified, restorable backup and record the deployed application release.
   Rehearse the release on an isolated restored database before the live change.
2. Run scripts/db/preflight-go-live-hardening.sql read-only. Check existing push
   key shapes and the permission to create the confirmed-email trigger. Record
   business-ledger and stock movement counts; do not modify those records.
3. Apply/register 0035–0040 in order and publish the matching application in the
   same maintenance window. New pages require the new RPCs; old clients cannot
   register new push devices after the subscription boundary changes. Existing
   registered devices continue through the validated sender.
4. Rerun preflight and verify that the RPC/helper flags reflect the new release
   and ledger/movement counts are unchanged. Avoid destructive down-migrations;
   repair with a forward migration if a rollback is necessary.
5. Smoke-test the payment detail route by direct navigation and refresh. Verify
   PO/payment history names as Purchase Manager and Accounts Manager, and both
   approval tabs as a separate Director. Verify denied project/company access.
6. Complete a disposable staging workflow including partial/damaged receipt,
   invoice matching/exception, payment approval, recording, printing, attachment
   access and reconciliation. Test real mail and physical-device push delivery.
7. Assign backup restore, server-error, background delivery and incident-response
   ownership. A database/HTTP failure must be visible to the operator.

**Opening stock:** the user confirmed the zero-cost opening entries are test
records and explicitly asked to leave them unchanged. This release changes no
stock value or ledger history. The dashboard now warns about unvalued stock and
unconfigured reorder thresholds. Replace/reconcile the test baseline through
approved business procedures before relying on production stock valuation.

**Status:** code and disposable acceptance improvements are prepared. This
document does not authorize live migration, publication, live bank transactions
or deletion of demonstration records, and does not certify those steps complete.
