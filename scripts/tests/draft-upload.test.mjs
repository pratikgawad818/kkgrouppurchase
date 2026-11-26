import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDraftUpload } from "../../src/lib/draft-upload.ts";

test("only successful same-file, same-scope uploads are reused", async () => {
  const draft = createDraftUpload();
  const file = {};
  let count = 0;
  const upload = async () => "path-" + ++count;
  assert.equal(await draft.get(file, "operator:bill1", upload), "path-1");
  assert.equal(await draft.get(file, "operator:bill1", upload), "path-1");
  assert.equal(await draft.get(file, "operator:bill2", upload), "path-2");
  assert.equal(await draft.get({}, "operator:bill2", upload), "path-3");
  draft.clear();
  assert.equal(await draft.get(file, "operator:bill2", upload), "path-4");
  assert.equal(await draft.get(file, "other:bill2", upload), "path-5");
});
test("failed upload is retried rather than cached", async () => {
  const draft = createDraftUpload();
  const file = {};
  await assert.rejects(draft.get(file, "draft", async () => { throw Error("offline"); }), /offline/);
  assert.equal(await draft.get(file, "draft", async () => "confirmed"), "confirmed");
});
test("finance forms retain scope, clear after saving and preserve original bytes", () => {
  const read = name => readFileSync("src/routes/_authenticated/_shell/" + name + ".tsx", "utf8");
  for (const name of ["finance.vendor-invoices.new", "finance.vendor-invoices.opening", "finance.payments.index"]) {
    const source = read(name);
    assert.ok(source.includes("draftUpload.get(file, uploadScope"));
    assert.ok(source.includes("me.data?.profile.id"));
    assert.ok(source.includes("draftUpload.clear()"));
  }
  const invoice = read("finance.vendor-invoices.new");
  assert.ok(invoice.includes("Invoice saved; submission could not be confirmed"));
  assert.ok(invoice.includes("return { id: data as string, submissionError: errMsg(error) }"));
  const finance = readFileSync("src/lib/finance.ts", "utf8");
  assert.ok(finance.includes("file.size < 1"));
  assert.ok(finance.includes(".upload(path, file,"));
});
