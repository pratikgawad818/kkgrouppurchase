import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateChallanPhoto } from "../../src/lib/challan-photo.ts";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("challan photo validation accepts only nonempty JPG/PNG images up to 10 MB", () => {
  for (const type of [
    { name: "received.jpg", type: "image/jpeg", size: 1000 },
    { name: "received.png", type: "image/png", size: 1000 },
  ]) assert.doesNotThrow(() => validateChallanPhoto(type));

  for (const type of [
    { name: "received.pdf", type: "application/pdf", size: 1000 },
    { name: "received.heic", type: "image/heic", size: 1000 },
    { name: "received.jpg", type: "image/jpeg", size: 0 },
    { name: "received.png", type: "image/png", size: 11 * 1024 * 1024 },
  ]) assert.throws(() => validateChallanPhoto(type));
});

test("site challan entry blocks saving without a photo and uploads evidence before registration", () => {
  const src = read("src/routes/_authenticated/_shell/inventory.delivery-challans.index.tsx");
  const input = read("src/components/erp/challan-photo-input.tsx");
  assert.match(src, /if \(!photoFile\) throw new Error/);
  assert.match(src, /uploadProcurementAttachment\(photoFile, companyId, userId\)/);
  assert.match(src, /photo_path: photoPath/);
  assert.match(src, /disabled=\{create\.isPending \|\| items\.isLoading \|\| !photoFile\}/);
  assert.match(input, /capture="environment"/);
  assert.match(input, /Choose photo/);
  assert.match(input, /Selected supplier challan photo/);
});

test("database enforces verified photo; old challans remain nullable and visible", () => {
  const sql = read("drizzle/migrations/0103_delivery_challan_photo_required.sql");
  const details = read("src/routes/_authenticated/_shell/inventory.delivery-challans.$id.tsx");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS photo_path text/);
  assert.match(sql, /IF photo_path IS NULL THEN/);
  assert.match(sql, /procurement_attachment_owned\(photo_path,p\.company_id,auth\.uid\(\)\)/);
  assert.match(sql, /CREATE POLICY "Delivery challan photo read"/);
  assert.match(sql, /can_access_project\(auth\.uid\(\),dc\.project_id\)/);
  assert.match(details, /View challan photo/);
  assert.match(details, /No photo on this historical record/);
});
