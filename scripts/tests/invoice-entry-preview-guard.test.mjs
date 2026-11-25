import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = p => readFileSync(p,"utf8");
const guard = read("src/lib/use-invoice-entry-guard.ts");
const preview = read("src/components/erp/invoice-entry-preview.tsx");
const pages = ["finance.vendor-invoices.opening.tsx","finance.vendor-invoices.new.tsx"].map(
  p => read("src/routes/_authenticated/_shell/"+p));

test("both invoice editors warn before abandoning user changes and clear the guard before successful navigation", () => {
  assert.ok(guard.includes("useBlocker({"));
  assert.ok(guard.includes("dirtyRef.current &&"));
  assert.ok(guard.includes("!window.confirm("));
  assert.ok(guard.includes("enableBeforeUnload: () => dirtyRef.current"));
  assert.ok(guard.includes("dirtyRef.current = false"));
  assert.doesNotMatch(guard, /localStorage|sessionStorage/);
  for (const page of pages) {
    assert.ok(page.includes("useInvoiceEntryGuard()"));
    assert.ok(page.includes("onChangeCapture={guard.markDirty}"));
    assert.ok(page.includes("guard.markSaved();"));
    assert.ok(page.includes("refetchOnWindowFocus: false"));
    assert.ok(page.includes("refetchOnReconnect: false"));
    assert.ok(page.includes("Unsaved changes"));
  }
  assert.ok(pages[0].includes("guard.markDirty();setPayments"));
  assert.ok(pages[0].includes("guard.markDirty();setLines"));
});

test("selected-document preview remains local and revokes replaced object URLs", () => {
  assert.ok(preview.includes("URL.createObjectURL(file)"));
  assert.ok(preview.includes("URL.revokeObjectURL(url)"));
  assert.ok(preview.includes('type="application/pdf"'));
  assert.ok(preview.includes('rel="noopener noreferrer"'));
  assert.doesNotMatch(preview, /supabase|uploadVendorDoc|fetch\(/);
  assert.doesNotMatch(preview, /image\/svg\+xml/);
  for (const page of pages) {
    assert.ok(page.includes("file && <InvoiceEntryPreview file={file} />"));
    assert.ok(page.includes("xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]"));
    assert.ok(page.includes("uploadVendorDoc"));
  }
});
