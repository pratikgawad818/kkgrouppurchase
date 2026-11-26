import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { workspaceNavigation } from "../../src/lib/workspace-navigation.ts";
import { canAccessPage } from "../../src/lib/page-access.ts";

const access=(role,...permissions)=>({roles:[role],permissions:new Set(permissions)});
const items=user=>workspaceNavigation(user).flatMap(g=>g.items);
const all=["inventory.view","payable.view","payment.view","financial.view","projects.manage"];

test("eligible staff have a single project reporting entry with master setup separate",()=>{
  const user=access("super_admin",...all);
  const nav=items(user);
  assert.equal(nav.find(x=>x.to==="/management")?.label,"Project overview");
  assert.equal(nav.find(x=>x.to==="/projects")?.label,"Project setup");
  assert.equal(nav.some(x=>x.to==="/reports/project-cost-control"),false);
  assert.equal(canAccessPage("/reports/project-cost-control",user),true);
});
test("financial-only staff retain the direct budget report; viewer stays read-only",()=>{
  const finance=items(access("accountant","financial.view"));
  assert.equal(finance.some(x=>x.to==="/reports/project-cost-control"),true);
  assert.equal(finance.some(x=>x.to==="/management"),false);
  const viewer=items(access("auditor",...all));
  assert.equal(viewer.some(x=>x.to==="/management"),true);
  assert.equal(viewer.some(x=>x.to==="/projects"),false);
  assert.equal(viewer.some(x=>x.to==="/reports/project-cost-control"),false);
});
test("overview preserves historical materials and permission-gates the embedded budget report",()=>{
  const route=readFileSync("src/routes/_authenticated/_shell/management.tsx","utf8");
  assert.ok(route.includes('canAccessPage("/reports/project-cost-control", access)'));
  assert.ok(route.includes('activeTab==="budget" && canBudget'));
  assert.ok(route.includes('recordedMaterialCost'));
  assert.ok(route.includes('project.historical.pending'));
  assert.ok(route.includes('activeTab==="overview"'));
  const report=readFileSync("src/components/erp/project-cost-control-panel.tsx","utf8");
  assert.ok(report.includes('Net stock issue cost'));
  assert.ok(report.includes('canAccessPage("/procurement/follow-ups", access)'));
});
