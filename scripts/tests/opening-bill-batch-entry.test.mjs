import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const page=readFileSync("src/routes/_authenticated/_shell/finance.vendor-invoices.opening.tsx","utf8");
test("batch entry queues at most 20 selected supplier documents and saves each individually",()=>{
 assert.ok(page.includes("files.length>20"));
 assert.ok(page.includes('type="file" multiple'));
 assert.ok(page.includes("Save & enter next bill"));
 assert.ok(page.includes("setFile(remaining[0] ?? null)"));
 assert.ok(page.includes("setBatch(remaining)"));
 assert.ok(page.includes('rpc("save_opening_vendor_invoice_v2"'));
 assert.ok(page.includes("setBatchSaved(current => [...current"));
 assert.ok(page.includes("if (remaining.length) guard.markDirty()"));
});
test("financial fields and historical settlements cannot carry across different documents",()=>{
 assert.ok(page.includes("setH({...initial,vendor_invoice_date:today()})"));
 assert.ok(page.includes("setPayments([]); setLegacyPaid(0)"));
 assert.ok(page.includes("setBatchVerified(false)"));
 assert.ok(page.includes("batch.length && !batchVerified"));
 assert.ok(page.includes("validation.length===0"));
 assert.ok(page.includes("<fieldset disabled={save.isPending}"));
});
test("duplicate detection uses vendor bill normalization and preserves server enforcement",()=>{
 assert.ok(page.includes('eq("vendor_id",h.vendor_id).not("status","in","(rejected,cancelled)")'));
 assert.ok(page.includes('.replace(/\\s/g,"").toLowerCase()'));
 assert.ok(page.includes("duplicateCheck.isSuccess"));
 assert.ok(page.includes("DUPLICATE_INVOICE"));
 assert.ok(page.includes("Final duplicate check runs on save"));
 assert.doesNotMatch(page,/localStorage|sessionStorage/);
});
