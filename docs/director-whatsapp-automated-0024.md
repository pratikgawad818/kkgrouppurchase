# KK GROUP Director Approval WhatsApp — source implementation (0024)

**NOT LIVE. No automatic messages have been sent. No production migration or
live Meta Business App connection has been authorized.**

## Designed operational flow

1. The Super Administrator creates **exactly three active Director accounts**,
   verifies each mobile number, and records genuine permission to receive
   approval notifications. The admin enters 12–500 characters of evidence;
   opt-in and opt-out are immutable audit events. Every opt-in is tied to a
   snapshot of the verified phone (a later profile phone change invalidates it).
2. An approved PO **submission** or scheduled payment **creation** triggers
   a queued notification row for eligible opted-in company directors.
   No notification is queued for the document creator or a director who
   already voted. No duplicate for the same document/director/stage.
   Admin can use **Prepare eligible alerts** to queue old pending documents
   created before the feature was active. This is idempotent.
3. A PRIVATE scheduled `POST /api/director-whatsapp-worker` endpoint checks
   a 32+-byte worker secret, all verified environment gates, then uses a
   SERVER-ONLY Supabase service role to claim up to three queued alerts with
   `FOR UPDATE SKIP LOCKED`. It rechecks current director role, consent,
   phone, company, document status and previous vote before calling Meta.
4. The worker sends a **Meta-approved utility template** with two text fields:
   `{{1}}` = 'Purchase Order' or 'Vendor Payment' (reminders have 'Reminder:')
   and `{{2}}` = document reference. A URL button at index 0 uses
   `https://<your-ERP-host>/approvals?ref={{1}}`, with an approved dynamic
   suffix `po_<uuid>` or `pay_<uuid>`. These are public document *locators*,
   not bearer tokens, and never provide approval authority. The Director signs
   into the ERP and votes via existing server-side, company-scoped, three-vote
   authorization RPCs.
5. Meta returns an accepted `wamid`; **accepted is NOT delivered, read or
   approved**. Definite 4xx rejections get `rejected` (except 408,409,429
   uncertain); unclear network/server outcomes become `unknown` and are
   **never automatically retried**. Expired claimed rows become `unknown`
   rather than risk duplicate sends. Migration 0025 and the disabled-by-default
   webhook add delivery/read receipts; see `director-whatsapp-receipts-0025.md`
   for separate staging and activation requirements.
6. The worker also queues up to **two** reminder stages after **24h and
   48h**, only following an earlier accepted stage and while the document
   remains awaiting this director's vote. A schedule must be configured on
   the deployment platform (e.g., every five minutes) with POST header
   `X-KK-Director-Worker-Secret`. There is no in-app infinite loop or cron
   configured in GitHub.

## All mandatory private server variables (NO values in GitHub or browser)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`KK_DIRECTOR_WA_WORKER_SECRET` (at least 32 bytes),
`KK_DIRECTOR_WA_SEND_ENABLED=true`,
`KK_DIRECTOR_WA_COEXISTENCE_VERIFIED=true`,
`KK_DIRECTOR_WA_CLOUD_PHONE_ID`,
`KK_DIRECTOR_WA_APPROVED_PHONE_ID` (exact allowlist match),
`KK_DIRECTOR_WA_WABA_ID`,
`KK_DIRECTOR_WA_APPROVED_WABA_ID` (exact allowlist match),
`KK_DIRECTOR_WA_ACCESS_TOKEN`,
`KK_DIRECTOR_WA_TEMPLATE_APPROVED=true`,
`KK_DIRECTOR_WA_TEMPLATE_NAME=kk_director_approval_v1`,
`KK_DIRECTOR_WA_APPROVAL_ORIGIN=https://<your-live-host>`.

`VITE_DIRECTOR_WA_UI_ENABLED=true` enables the *admin UI* only **after**
migration 0024 is applied in staging and tested. It does NOT turn on
Meta sending. Both default to off when unset.

## Safety gates

- **Preserve existing WhatsApp Business App number +91 98234 36577.**
  Business App / Cloud API coexistence has **not been verified**; never
  register, migrate, deregister or connect that number under an ordinary
  Cloud API 'Add phone' workflow. Meta portfolio/WABA and approved message
  template must be reviewed and verified separately with the operator.
- Use 0019→0020→0021→0022→0023→**0024** as reviewed linear migration chain,
  after a restorable backup and an isolated staging clone.
- Never expose Meta/system-worker credentials in Vite, browser console,
  GitHub actions, HTML, query strings or copyable links.
- Never treat a WhatsApp reply ('approve') as an approval. All approval
  transactions still require the three independent, authenticated director
  votes and prohibit self-approval.
- Existing **manual WhatsApp drafts remain supported** during the transition.
- Management Viewer has no access to consent details or notification phone
  snapshots. No invoice, payment, accounting or vendor data are changed.
- The 0024 implementation alone does **NOT** assert delivery/read receipts;
  0025 webhook activation, opt-in evidence review, Meta utility-template approval,
  live coexistence verification and real authenticated mobile browser testing
  remain explicit external activation gates.
