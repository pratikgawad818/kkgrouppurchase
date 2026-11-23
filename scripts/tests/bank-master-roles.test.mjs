import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/migrations/0116_account_and_vendor_bank_management.sql","utf8");
const route = readFileSync("src/routes/_authenticated/_shell/settings.bank-accounts.tsx","utf8");
const vendors = readFileSync("src/routes/_authenticated/_shell/vendors.tsx","utf8");
const editor = readFileSync("src/components/erp/vendor-bank-editor.tsx","utf8");
const access = readFileSync("src/lib/page-access.ts","utf8");
const nav = readFileSync("src/lib/workspace-navigation.ts","utf8");

test("only Super Admin and Accounts Manager can edit the company bank master", () => {
  assert.match(sql, /'super_admin','company.bank.manage'/);
  assert.match(sql, /'accounts_manager','company.bank.manage'/);
  assert.match(sql, /DROP POLICY IF EXISTS "Manage bank accounts"/);
  assert.match(sql, /CREATE POLICY "Bank managers update"/);
  assert.match(sql, /CREATE POLICY "Bank managers insert"/);
  assert.match(sql, /REVOKE DELETE,TRUNCATE ON public.company_bank_accounts/);
  assert.match(access, /bank-accounts.*company.bank.manage.*super_admin.*accounts_manager/);
  assert.match(nav, /"\/settings\/bank-accounts"/);
  assert.match(route, /can\("company.bank.manage"\)/);
  assert.match(route, /roles.some\(role => role === "super_admin" \|\| role === "accounts_manager"\)/);
});

test("company bank edits preserve payment identity and belong to verified legal entities", () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS account_holder_name/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS legal_entity_id/);
  assert.match(sql, /e.company_id=NEW.company_id/);
  assert.match(sql, /Bank account company cannot be changed/);
  assert.match(route, /mask\(a.account_number\)/);
  assert.match(route, /No bank account was saved/);
  assert.match(route, /"inactive"/);
  assert.doesNotMatch(sql, /UPDATE public.vendor_payments|DELETE FROM public.vendor_payments|UPDATE public.purchase_orders/);
});

test("vendor bank updates are a separate role-guarded operation", () => {
  assert.match(sql, /guard_vendor_bank_edit_roles/);
  assert.match(sql, /public.has_role\(auth.uid\(\),'super_admin'\)/);
  assert.match(sql, /public.has_role\(auth.uid\(\),'accounts_manager'\)/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF bank_account_name,bank_name,bank_account_number,ifsc/);
  assert.match(vendors, /canManageBank/);
  assert.match(vendors, /<VendorBankEditor/);
  assert.match(editor, /bank_account_name/);
  assert.match(editor, /bank_account_number/);
  assert.match(editor, /type=\{showNumber \? "text" : "password"\}/);
  assert.doesNotMatch(editor, /delete\(\)/);
});
