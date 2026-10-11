# WhatsApp Phase 3A — source-only consent & notification audit foundation

Migration `drizzle/migrations/0022_whatsapp_consent_outbox.sql` is a **staging-only proposal**.
It MUST NOT be run on the active Supabase project without backups, migration
ordering (0019 → 0020 → 0021 → 0022) and staging acceptance.

## Data model

- `wa_vendor_consents`: one current supplier consent decision, recording
  source, evidence description, author and phone snapshot. No row = unknown,
  **not consent**. Current grant is valid only if the vendor's **current**
  verified master phone matches the grant's stored number.
- `wa_consent_events`: append-only chronological grants/revocations, with
  actor, source, evidence and preceding status.
- `wa_notification_drafts`: one immutable initial draft per supplier,
  document and operation (RFQ, approved PO, or PO delivery reminder).
  Only `draft` and `cancelled` exist; **no sent, queued or delivered state**.
  A repeat identical creation returns the same ID, without duplicating events.
  An edited body or changed phone cannot silently overwrite an existing draft.
- `wa_notification_events`: append-only draft creation/cancellation events.
  No direct INSERT/UPDATE/DELETE permissions for authenticated clients.

**Authorization**: tenant-scoped RLS on all four tables; management viewers
cannot view communication metadata or write anything. SECDEF RPCs check
authenticated active company membership, permitted module action, supplier
company, document ownership, assigned project and PO approval states. Consent
records require `vendors.manage`. The company-specific actor cannot
create consents/drafts for another company's supplier.

**No actual sending**: The functions DO NOT call WhatsApp Cloud API, open
`wa.me`, send messages, assume supplier opt-in, or process draft rows.
The only sandbox sender remains in the isolated manual test page and cannot
read from this outbox. A draft can be stored **without valid consent** but
must never be treated as authorized to send.

## Evidence and limitations

A user's written evidence note is an **attestation**, not cryptographic
proof of consent. Validate the source outside the ERP; retain only necessary
details. A telephone-call entry is not a substitute for Meta's messaging
permission/opt-in requirements. **Opt-out/revocation takes precedence** and
number changes invalidate the prior grant.

The migration adds no client UI; it lays down an isolated DB foundation.
A future notification center requires staged test accounts, typed Supabase
API regeneration, UI for consent and queued drafts, actual recipient opt-out
checks, template management, webhook verification, TTL/retention policies,
reviewed outbound job authorization and idempotent retries.

Meta's supplier messaging cannot begin until separate legal/coexistence
checks and explicit go-live approval. The existing KK GROUP Purchase WhatsApp
Business app and main Meta Business portfolio remain untouched.

## Quality gates

`scripts/db/test_whatsapp_0022_acl.py` installs migration 0022 on
**disposable PostgreSQL** after 0020/0021, tests cross-company access,
unauthorized direct modifications, stale-phone consent, audit events,
PO status checks and duplicate creation. CI refuses any non-disposable DB.

No deployment, live DB migration, real WhatsApp message or Lovable credits.
