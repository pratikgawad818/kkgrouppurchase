# Pending migrations 0019–0023 — ordered disposable SQL rehearsal

The release rehearsal executes every **real pending migration source** in one
session in **strict numeric order**: `0019 → 0020 → 0021 → 0022 → 0023`.
Earlier migrations are represented by a restricted synthetic fixture mirroring
the relevant tables, role enum, grants, storage objects and legacy policies.
It does not access the Lovable Cloud database or reuse customer records.

The test proves that the five SQL scripts can be installed in sequence over
this **simulated** 0018-era schema and that final company/role scoping and
two new subsystems work together:

- Management Viewer can see permitted small-expense reports, but cannot write.
- The other company's administrator cannot read or write the first company's
  consent, outbox or expense rows.
- Site staff cannot write small expenses.
- New WhatsApp consent, draft and expense tables have RLS enabled and **no
  direct authenticated INSERT, UPDATE or DELETE grants**.
- Authenticated super administrators can record an expense and its audit event.
- Approved procurement admin can record supplier opt-in and an RFQ draft;
  **nothing is sent through WhatsApp**.
- The existing synthetic companies, projects and vendor rows survive the
  ordered SQL installation.

Run `python scripts/db/test_release_0019_0023_order.py` ONLY from GitHub
Actions with `CI=true` and an isolated database named `release_qa`.
The fixture intentionally does NOT fully replay `0000–0018` and is not a
backup-restore test. CI success must not be mistaken for compatibility with
manual live overrides, third-party Supabase platform grants, or real business
records. A staging **clone of the actual live DB with a verified restore** and
operator/viewer browser test is still the last release gate.

**No production migration run or Lovable Publish is authorized by this test.**
