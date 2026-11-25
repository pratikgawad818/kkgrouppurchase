import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const viewer = readFileSync("src/components/erp/document-viewer.tsx", "utf8");
const attachment = readFileSync("src/lib/attached-document-preview.ts", "utf8");

test("closing, replacing or unmounting a preview aborts its work", () => {
  assert.equal(viewer.match(/currentDoc\.current\?\.controller\?\.abort\(\)/g)?.length, 3);
  assert.ok(viewer.includes('if (controller.signal.aborted) { revoke(file); return; }'));
  assert.ok(viewer.includes('previous.previewId !== next.previewId'));
  assert.doesNotMatch(viewer, /setDoc\(previous\s*=>/);
  assert.ok(viewer.includes('loading={index === 0 ? "eager" : "lazy"}'));
});

test("private attachment renderer cancels current PDF task and releases resources", () => {
  assert.ok(attachment.includes('renderPrivatePdfPages(file, preview.signal)'));
  assert.ok(attachment.includes('if (preview.signal.aborted) return;'));
  assert.ok(attachment.includes('const cancel = () => task.cancel()'));
  assert.ok(attachment.includes('signal.removeEventListener("abort", cancel)'));
  assert.match(attachment, /finally \{\s*page\.cleanup\(\);\s*canvas\.width = 0;\s*canvas\.height = 0;/);
  assert.match(attachment, /finally \{\s*await loadingTask\.destroy\(\)/);
  assert.ok(attachment.includes('supabase.storage.from(PROCUREMENT_ATTACHMENT_BUCKET).download(path)'));
});
