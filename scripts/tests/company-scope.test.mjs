import assert from "node:assert/strict";
import test from "node:test";
import { requireSingleCompanyId } from "../../src/lib/company-scope.ts";

test("rejects missing or ambiguous company access for master data", () => {
  assert.equal(requireSingleCompanyId([{ id: "company-1" }]), "company-1");
  assert.throws(() => requireSingleCompanyId([]), /No accessible company/);
  assert.throws(() => requireSingleCompanyId(null), /No accessible company/);
  assert.throws(() => requireSingleCompanyId([{ id: "" }]), /No accessible company/);
  assert.throws(() => requireSingleCompanyId([{ id: "company-1" }, { id: "company-2" }]), /Multiple companies/);
});
