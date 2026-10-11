# KK GROUP Purchase — WhatsApp Cloud API sandbox (phase 1)

This integration **only** sends Meta's fixed `hello_world` template through the
separate KK GROUP Purchase developer app test number. It **cannot** send to
suppliers or use the actual purchase phone, and it is inactive by default.

Meta sandbox identifiers (not secrets):
- Developer App ID: `1103623782629172`
- Test sender: `+1 (555) 657-8423`
- Test Phone Number ID: `1463820473473034`
- Test WABA ID: `2335711970592462`

## Server-only environment variables

Configure **private hosting runtime** variables after explicit authorization.
Do not store the temporary token in the code, client, `VITE_*` values, GitHub,
Lovable chat, localStorage, or public Supabase tables.

| Key | Value |
| --- | --- |
| `KK_WHATSAPP_TEST_ENABLED` | `true` (default is disabled) |
| `KK_WHATSAPP_TEST_PHONE_NUMBER_ID` | `1463820473473034` |
| `KK_WHATSAPP_TEST_WABA_ID` | `2335711970592462` |
| `KK_WHATSAPP_TEST_ACCESS_TOKEN` | Secret temporary token obtained in Meta |
| `KK_WHATSAPP_TEST_RECIPIENT` | Verified personal test number, e.g. `+91XXXXXXXXXX` |

Both IDs must match the pinned sandbox account; otherwise the server refuses
to send. The temporary Meta token expires and must be renewed securely.

After a reviewed deployment, log in as an **active super_admin**, visit
`/settings/whatsapp`, inspect the masked recipient, tick the single-message
confirmation, and click Send. A returned message ID means **API acceptance**,
not delivery. Confirm on the receiving phone.

The server independently checks authenticated identity, active company-linked
profile, and current `super_admin` role. Client-side navigation rules also
prevent unauthorized access. Input contains only `confirm: true`; clients
cannot choose a number, sender, template, or arbitrary message. No retries.

## Not part of this release

- No production WhatsApp number registration and no main Meta portfolio changes.
- No supplier messaging, purchase order PDFs, automated follow-ups or bulk sends.
- No durable message log/outbox, delivery webhooks, consent or template approval
  management. Those require staged RLS-protected migrations, idempotency,
  throttling and an explicit production launch approval.
- No live Supabase changes or migration applications.
- No credentials configured or Lovable credits spent by the code change.
- Sandbox acceptance **does not** prove Business App + API coexistence.

The standard API onboarding for the working business phone is **not safe** as
a shortcut; investigate supported coexistence eligibility first. CI mocks Meta
requests and cannot validate real Meta delivery.
