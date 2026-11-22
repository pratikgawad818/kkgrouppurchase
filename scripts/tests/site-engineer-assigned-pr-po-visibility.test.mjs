import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canReceiveAssignedProject } from "../../src/lib/receiving-project-access.ts";

const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const pr = read("src/routes/_authenticated/_shell/procurement.purchase-requests.index.tsx");
const po = read("src/routes/_authenticated/_shell/procurement.purchase-orders.index.tsx");
const prDetail = read("src/routes/_authenticated/_shell/procurement.purchase-requests.$id.index.tsx");
const poDetail = read("src/routes/_authenticated/_shell/procurement.purchase-orders.$id.tsx");
const scope = read("src/lib/site-engineer-receiving-scope.ts");

test("PR and PO list queries explicitly limit Site Engineers to assigned project IDs",()=>{
  assert.match(scope, /from\("user_project_assignments"\)/);
  assert.match(scope, /eq\("user_id", userId\)/);
  assert.match(scope, /export function useSiteEngineerProjectScope/);
  assert.match(scope, /useSiteEngineerReceivingScope = useSiteEngineerProjectScope/);
  assert.equal((pr.match(/if \(scope\.isScopedEngineer\) r = r\.in\("project_id", scope\.assignedProjectIds\);/g)||[]).length,2,
    "Both paginated and search PR queries must be scoped");
  assert.match(po,/if \(scope\.isScopedEngineer\) query = query\.in\("project_id", scope\.assignedProjectIds\);/);
  assert.match(pr,/if \(scope\.isScopedEngineer && !scope\.assignedProjectIds\.length\)/);
  assert.match(po,/if \(scope\.isScopedEngineer && !scope\.assignedProjectIds\.length\)/);
});

test("PR/PO details fail closed and separate cached identities",()=>{
  assert.match(prDetail,/scope\.isScopedEngineer && !scope\.canAccess\(pr\.project_id\)/);
  assert.match(poDetail,/scope\.isScopedEngineer && !scope\.canAccess\(po\.project_id\)/);
  for(const file of [pr,po,prDetail,poDetail]){
    assert.match(file,/scope\.userId/);
    assert.match(file,/scope\.assignedProjectIds/);
  }
});

test("assigned-project access is independent of document creator or requester",()=>{
  const assigned=["project-k"];
  assert.equal(canReceiveAssignedProject("project-k",assigned,true),true);
  assert.equal(canReceiveAssignedProject("project-a",assigned,true),false);
  assert.equal(canReceiveAssignedProject("project-k",[],true),false);
  assert.equal(canReceiveAssignedProject("project-a",[],false),true);
  assert.doesNotMatch(pr,/scope\.isScopedEngineer[^\n]*requested_by/);
  assert.doesNotMatch(po,/scope\.isScopedEngineer[^\n]*created_by/);
});
