# KK GROUP director approval notifications — rollout guide

## What works in this branch

- `/approvals` is a mobile-first, authenticated approval inbox.
- Directors vote using their individual ERP identities; WhatsApp links do not authorize a vote.
- Administrators can open **Director Approvals** and generate a separate WhatsApp draft for each active director with a phone number. The sender presses **Send** manually.
- The message deep-links into a specific pending PO/payment: `/approvals?kind=purchase_order&id=<uuid>` or `/approvals?kind=vendor_payment&id=<uuid>`. The user signs in before viewing.
- Approval progress is recorded in the database; three distinct directors are required to fully approve.
- No WhatsApp phone number, API key, server webhook, or provider contract is required to use manual draft links.

## Before using approvals with real transactions

1. Invite **exactly three** active director accounts using **Settings → Users & Roles**. Enter each director's own WhatsApp number in E.164 format (e.g., `+91...`).
2. Directors must set their own passwords. Do not share the administrator password.
3. Verify the existing PO creator/payment scheduler is **not one of those directors** (the existing segregation-of-duties rule prohibits voting on one's own transactions).
4. Apply and validate migrations `0012_three_director_approvals.sql` and `0013_company_scoped_director_votes.sql` in that order against a **staging** database. Do not treat merging GitHub SQL as confirmation it ran in production.
5. Confirm the permissions `purchase_order.approve`, `payment.approve`, and document visibility are assigned to all directors.
6. Test with three distinct director identities: first and second votes leave PO pending/payment scheduled; third vote approves; repeat vote fails; non-director or wrong-company vote fails; a director's own created document cannot be approved by themselves.
7. Check PO rejection requires a reason, re-submission resets prior votes, payment cannot be recorded before all approvals, and finance history/ledger entries remain correct.
8. Test mobile deep links while logged out and logged in; verify project and company RLS. Test with missing/incorrect phone numbers.
9. Only after a successful **staging** test, plan production migration and operational training.

The existing payment transition supports **approve, record, cancel**; it does not offer individual director **reject**. Do not mislabel **cancel** as director rejection. Introduce a separate, audited payment rejection workflow before exposing that action.

## How to activate automatic WhatsApp delivery later

When KK GROUP receives its new dedicated business number, set up **Meta Business Portfolio → WhatsApp Business Account → WhatsApp Cloud API**, verify/register the number and request approval for a utility template for transactional approval notifications.

Automatic sending is **not present** yet. A secure server-side notification queue/worker and Meta webhook delivery handling must be implemented before claiming this is automatic. The integration must:
- Send to the director phone number read from an authorized company profile.
- Use a Meta-approved template with a URL to the authenticated approval page.
- Keep the access token, phone-number ID and webhook verification secret **server-side only**; never in Vite `VITE_*` variables or browser JavaScript.
- Retry transient failures with bounded backoff, deduplicate notifications per director and request, and record delivery errors.
- Revalidate PO/payment status and current director eligibility before sending. Never assume a WhatsApp delivery receipt is an approval.
- Avoid disclosing bank details or secrets in messages; log minimal data and comply with WhatsApp opt-in and template policies.

**One company-owned WhatsApp sender number is enough.** The three directors use their own mobile numbers and independent ERP logins. A dedicated smartphone is useful for business administration and number verification, but the Cloud API itself sends messages from the server.
