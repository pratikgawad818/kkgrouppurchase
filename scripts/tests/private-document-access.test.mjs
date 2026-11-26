import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=p=>readFileSync(p,"utf8");

test("vendor documents and avatars do not issue reusable signed URLs",()=>{
  const finance=read("src/lib/finance.ts");
  const avatar=read("src/lib/avatar.ts");
  assert.doesNotMatch(finance,/createSignedUrl/);
  assert.doesNotMatch(avatar,/createSignedUrl/);
  assert.ok(finance.includes('from("vendor-documents").download(path)'));
  assert.ok(avatar.includes('from("avatars").download(path!)'));
  assert.ok(finance.includes("URL.revokeObjectURL(url)"));
  assert.ok(avatar.includes("URL.revokeObjectURL(url)"));
  assert.ok(avatar.includes("gcTime: 0"));
});
test("approved invoice replacements are restricted to new owned uploads",()=>{
  const sql=read("drizzle/migrations/0122_opening_invoice_attachment_ownership.sql");
  assert.ok(sql.includes("btrim(_attachment_path) IS DISTINCT FROM inv.attachment_path"));
  assert.ok(sql.includes("public.actor_in_company(inv.company_id)"));
  assert.ok(sql.includes("obj.bucket_id='vendor-documents'"));
  assert.ok(sql.includes("obj.owner_id=auth.uid()::text"));
  assert.ok(sql.includes("other.id<>_id AND other.attachment_path=btrim(_attachment_path)"));
  assert.ok(sql.includes("payment.proof_path=btrim(_attachment_path)"));
  assert.ok(sql.includes("round(check_subtotal,2)<>round(inv.subtotal,2)"));
  assert.ok(sql.includes("round(check_gst,2)<>round(inv.tax_total,2)"));
  const j=JSON.parse(read("drizzle/migrations/meta/_journal.json"));
  assert.ok(j.entries.some(e=>e.tag==="0122_opening_invoice_attachment_ownership"));
});
