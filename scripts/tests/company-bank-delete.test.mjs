import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/migrations/0117_delete_unused_company_bank_accounts.sql","utf8");
const ui = readFileSync("src/routes/_authenticated/_shell/settings.bank-accounts.tsx","utf8");
const qa = readFileSync("scripts/db/test_bank_master_0116.py","utf8");

test("bank deletion requires company bank manager role and active same-company actor", () => {
  assert.match(sql, /public\.is_active_user\(auth\.uid\(\)\)/);
  assert.match(sql, /public\.has_permission\(auth\.uid\(\), 'company\.bank\.manage'\)/);
  assert.match(sql, /public\.has_role\(auth\.uid\(\), 'super_admin'\)/);
  assert.match(sql, /public\.has_role\(auth\.uid\(\), 'accounts_manager'\)/);
  assert.match(sql, /public\.actor_in_company\(account\.company_id\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.delete_unused_company_bank_account/);
});

test("primary accounts or those used in ANY payment cannot be deleted", () => {
  assert.match(sql, /FROM public\.company_bank_accounts[\s\S]+?FOR UPDATE/);
  assert.match(sql, /IF account\.is_primary THEN/);
  assert.match(sql, /FROM public\.vendor_payments vp[\s\S]+?vp\.bank_account_id = account\.id/);
  assert.match(sql, /foreign_key_violation/);
  assert.match(qa, /bank_account_id uuid REFERENCES public\.company_bank_accounts/);
  assert.match(qa, /SELECT public\.delete_unused_company_bank_account/);
  assert.doesNotMatch(sql, /DELETE FROM public\.vendor_payments/);
});

test("bank deletion requires a deliberate confirmation and preserves audit triggers", () => {
  assert.match(ui, /Delete bank account\?/);
  assert.match(ui, /deleteConfirmation !== "DELETE"/);
  assert.match(ui, /_account_id: deleting\.id/);
  assert.match(ui, /_last_four: deleting\.account_number\.slice\(-4\)/);
  assert.match(ui, /disabled=\{a\.is_primary\}/);
  assert.match(ui, /linked to a payment/);
  assert.doesNotMatch(sql, /DROP TRIGGER.*audit_company_bank_accounts/);
  assert.doesNotMatch(ui, /\.from\("company_bank_accounts"\)\.delete\(/);
});
