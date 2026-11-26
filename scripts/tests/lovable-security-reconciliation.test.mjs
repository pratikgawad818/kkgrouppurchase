import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("private document and avatar retrieval remain authenticated",()=>{
  const avatar=readFileSync("src/lib/avatar.ts","utf8");
  const finance=readFileSync("src/lib/finance.ts","utf8");
  assert.doesNotMatch(avatar+finance,/createSignedUrl/);
  assert.match(avatar,/\.download\(path!\)/);
  assert.match(avatar,/URL\.revokeObjectURL\(url\)/);
  assert.match(avatar,/staleTime: 30_000/);
  assert.match(finance,/\.download\(path\)/);
});
test("migration restores invite-only profile guard and preserves historical attachments",()=>{
  const sql=readFileSync("drizzle/migrations/0122_reconcile_lovable_security.sql","utf8");
  assert.doesNotMatch(sql,/INSERT INTO public\.profiles/i);
  assert.match(sql,/NOT p\.is_active/);
  assert.match(sql,/public\.user_roles/);
  assert.match(sql,/o\.owner_id=auth\.uid\(\)::text/);
  assert.match(sql,/NEW\.attachment_path IS NOT DISTINCT FROM OLD\.attachment_path/);
});
