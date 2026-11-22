import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canReceiveAssignedProject } from "../../src/lib/receiving-project-access.ts";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("a second site engineer can receive a colleague's PO for the same assigned project", () => {
  const engineerBAssignments = ["project-kk-park", "project-city-centre"];
  // Authorization uses PO project, not the requesting engineer's user ID.
  assert.equal(canReceiveAssignedProject("project-kk-park", engineerBAssignments, true), true);
  assert.equal(canReceiveAssignedProject("project-city-centre", engineerBAssignments, true), true);
  assert.equal(canReceiveAssignedProject("project-other", engineerBAssignments, true), false);
  assert.equal(canReceiveAssignedProject("project-kk-park", [], true), false);
  // An authorized Director/manager is not accidentally restricted by this UI guard.
  assert.equal(canReceiveAssignedProject("project-other", [], false), true);
});

test("both Site Engineer selectors explicitly query project-assigned POs, not own-created POs", () => {
  const receiving = read("src/routes/_authenticated/_shell/inventory.goods-received.index.tsx");
  const challans = read("src/routes/_authenticated/_shell/inventory.delivery-challans.index.tsx");
  for (const source of [receiving, challans]) {
    assert.match(source, /useSiteEngineerReceivingScope/);
    assert.match(source, /\.in\("project_id", scope\.assignedProjectIds\)/);
    assert.match(source, /scope\.isScopedEngineer/);
    assert.doesNotMatch(source, /\.eq\("created_by"/);
    assert.doesNotMatch(source, /\.eq\("requested_by"/);
  }
});

test("server still enforces exact project and company for registration and receipt", () => {
  const challan = read("drizzle/migrations/0103_delivery_challan_photo_required.sql");
  const grn = read("drizzle/migrations/0014_vendor_delivery_challans.sql");
  assert.match(challan, /can_access_project\(auth\.uid\(\), p\.project_id\)/);
  assert.match(challan, /actor_in_company|v\.company_id=p\.company_id/);
  assert.match(challan, /photo_path IS NULL/); // mandatory evidence retained
  assert.match(grn, /can_access_project\(auth\.uid\(\), p\.project_id\)/);
  assert.match(grn, /IF _post AND NOT has_permission\(auth\.uid\(\),'grn\.post'\)/);
});
