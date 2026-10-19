import test from "node:test";
import assert from "node:assert/strict";
import { directorCanFinalizeOwnPurchasing } from "../../src/lib/purchasing-authority.ts";

test("only a Director role without Super Admin can finalize their own purchasing", () => {
  assert.equal(directorCanFinalizeOwnPurchasing(["director"]), true);
  assert.equal(directorCanFinalizeOwnPurchasing(["director", "purchase_manager"]), true);
  for (const roles of [
    [],
    ["purchase_manager"],
    ["site_engineer"],
    ["super_admin"],
    ["super_admin", "director"],
  ])
    assert.equal(directorCanFinalizeOwnPurchasing(roles), false);
});
