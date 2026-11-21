import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql=readFileSync("drizzle/migrations/0090_tenant_and_staff_security_guards.sql","utf8");
const avatar=readFileSync("drizzle/migrations/0091_private_company_avatars.sql","utf8");

test("new self-provisioned profiles cannot become active staff of the first company",()=>{
  assert.match(sql,/ALTER TABLE public\.profiles ALTER COLUMN is_active SET DEFAULT false/);
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.ensure_profile\(\)/);
  assert.match(sql,/SELECT \* INTO p FROM public\.profiles WHERE id=auth\.uid\(\)/);
  assert.match(sql,/NOT p\.is_active OR p\.company_id IS NULL/);
  assert.match(sql,/public\.user_roles r WHERE r\.user_id=p\.id/);
  assert.doesNotMatch(sql,/INSERT INTO public\.profiles/);
  assert.doesNotMatch(sql,/ORDER BY created_at LIMIT 1/);
});

test("revoked site access blocks read of own historic purchase request",()=>{
  assert.match(sql,/CREATE POLICY "View PRs"/);
  assert.match(sql,/public\.has_permission\(auth\.uid\(\),'purchase_request\.view'\)/);
  assert.match(sql,/public\.actor_in_company\(company_id\)/);
  assert.match(sql,/public\.can_access_project\(auth\.uid\(\),project_id\)/);
  assert.doesNotMatch(sql,/requested_by\s*=\s*auth\.uid\(\)\s*OR/);
});

test("stock adjustment enforces actor, active warehouse company and project",()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.create_stock_adjustment/);
  assert.match(sql,/public\.has_permission\(actor,'inventory\.adjust'\)/);
  assert.match(sql,/public\.actor_in_company\(c\)/);
  assert.match(sql,/site IS NOT NULL AND NOT public\.can_access_project\(actor,site\)/);
  assert.match(sql,/item\.company_id=c AND item\.status='active'/);
});

test("stock transfer validates both stores and all materials before stock posting",()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.execute_stock_transfer/);
  assert.match(sql,/public\.has_permission\(actor,'inventory\.transfer'\)/);
  assert.match(sql,/dest_company IS DISTINCT FROM c/);
  assert.match(sql,/public\.actor_in_company\(c\)/);
  assert.match(sql,/from_project IS NOT NULL AND NOT public\.can_access_project\(actor,from_project\)/);
  assert.match(sql,/to_project IS NOT NULL AND NOT public\.can_access_project\(actor,to_project\)/);
  assert.match(sql,/item\.company_id=c AND item\.status='active'/);
});

test("stock adjustment and line-item SELECT policies are company and project scoped",()=>{
  assert.match(sql,/CREATE POLICY "Inventory viewers read adjustments"/);
  assert.match(sql,/CREATE POLICY "Inventory viewers read adjustment items"/);
  assert.match(sql,/public\.actor_in_company\(company_id\)/);
  assert.match(sql,/public\.actor_in_company\(a\.company_id\)/);
});

test("avatar access requires active same-company colleague or own folder",()=>{
  assert.match(avatar,/CREATE OR REPLACE FUNCTION public\.can_read_company_avatar/);
  assert.match(avatar,/viewer\.id=auth\.uid\(\)/);
  assert.match(avatar,/viewer\.is_active/);
  assert.match(avatar,/owner\.company_id=viewer\.company_id/);
  assert.match(avatar,/owner\.avatar_url=_path/);
  assert.match(avatar,/AND public\.can_read_company_avatar\(name\)/);
});
