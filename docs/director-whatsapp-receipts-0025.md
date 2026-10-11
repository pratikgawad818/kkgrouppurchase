# Director WhatsApp delivery receipts (0025)

This is source code for review and staging. It is disabled by default. No live
migration, Meta connection, message send or deployment is performed by this PR.

`GET /api/director-whatsapp-webhook` supports Meta subscription verification.
`POST` validates `X-Hub-Signature-256` against the exact request bytes with the
Meta app secret before parsing JSON. Both WABA and phone-number ID must match
the private approved allowlists. The receiver limits bodies to 256 KiB and
batches to 100 unique receipts. Other senders and incoming message content are
ignored. No reply or delivery receipt creates a director vote.

Only minimal status metadata is retained: message ID, recipient, provider
timestamp, state and numeric failure code. No raw callback body, arbitrary
error message or contact name is logged or stored. The new receipt inbox is
service-role-only; administrators and individual directors see summaries on
the existing company-scoped outbox rows through the existing RLS policies.

The callback acknowledges only after its atomic database RPC commits. An
outage returns 503 so Meta can retry; duplicate events are harmless. The SQL
serializes callbacks with sender completion and stores early receipts while a
recipient has an in-flight claim. A trigger reconciles these when the worker
records the accepted message ID. Message ID AND recipient must match.
Unrelated early receipts cannot affect another message and expire after seven
days during ingestion. Matched receipts remain audit evidence. If no callbacks
arrive, a private maintenance schedule may delete only unmatched inbox rows
older than seven days; deployment retention policy must document that schedule.

Evidence progresses from sent to failed/delivered to read; delivered/read
evidence wins over delayed failures or sent callbacks. The original `accepted`
state stays separate. A failed delivery does not trigger an automatic resend.
Uncertain sends without a recorded message ID still require manual review.
Read receipts can be absent; the UI never infers read or a vote from delivery.

## Activation after staging acceptance

1. Apply reviewed migrations through 0024, then 0025, on an isolated staging
   database. Inspect duplicate non-null message IDs before creating the unique
   index. A migration failure must be resolved before enabling the receiver.
2. Set private server variables: `KK_DIRECTOR_WA_WEBHOOK_ENABLED=true`,
   `KK_DIRECTOR_WA_META_APP_SECRET` (at least 32 characters),
   `KK_DIRECTOR_WA_WEBHOOK_VERIFY_TOKEN` (random, at least 32 characters),
   approved phone/WABA IDs from 0024, `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`. Never use VITE variables for these secrets.
   Receiving receipts can remain enabled while sending is disabled.
3. Configure the HTTPS callback URL in the correct Meta application and
   subscribe that application to the intended WABA messages events. Verification
   alone does not subscribe the WABA. Check signature forwarding through the
   hosting proxy; signed request bytes must arrive unchanged.
4. After applying 0025, set `VITE_DIRECTOR_WA_RECEIPTS_UI_ENABLED=true` alongside
   the existing alert UI flag. Leaving it unset preserves 0024 compatibility.
5. With an authorized staging sender and test recipient, check actual sent,
   delivered/read, failure, retries and independent director login/votes on
   mobile. Then review the production migration, backups, schedule and Meta
   connection before activation. Existing business-number coexistence gates
   from 0024 remain applicable.

## Validation

Node tests exercise signature tampering, verification, sender isolation, mixed
payloads, input limits, ignored incoming replies and durable acknowledgement.
The disposable PostgreSQL test executes actual 0024 and 0025 SQL and checks ACL,
deduplication, state ordering, early callbacks, concurrent worker completion,
inbox expiry and absence of approval votes. GitHub CI runs it with synthetic
data in `director_wa_qa`; it refuses other databases.

Protocol references: [Meta webhook verification and signature handling](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/)
and [Meta status object reference](https://www.postman.com/meta/whatsapp-business-platform/folder/fuaee8l/statuses-object).
