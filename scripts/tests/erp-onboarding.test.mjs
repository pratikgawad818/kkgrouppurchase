import test from "node:test";
import assert from "node:assert/strict";
import { setupCompletion, setupSteps } from "../../src/lib/erp-onboarding.ts";

const empty = { projects: 0, vendors: 0, categories: 0, materials: 0, warehouses: 0 };

test("clean-slate company gets a useful setup path without seeded demo records", () => {
  const progress = setupCompletion(empty);
  assert.deepEqual(progress, { completed: 0, total: 5, ready: false });
  const steps = setupSteps(empty);
  assert.deepEqual(steps.map(x => x.key), [
    "projects", "categories", "materials", "vendors", "warehouses",
  ]);
  assert.deepEqual(steps.map(x => x.to), [
    "/projects", "/materials", "/materials", "/vendors", "/warehouses",
  ]);
  assert.ok(steps.every(x => !x.completed));
});

test("creating one master advances progress while others remain incomplete", () => {
  const counts = { ...empty, projects: 1, categories: 1 };
  const progress = setupCompletion(counts);
  assert.deepEqual(progress, { completed: 2, total: 5, ready: false });
  assert.deepEqual(setupSteps(counts).filter(x => x.completed).map(x => x.key), ["projects", "categories"]);
});

test("complete setup checklist disappears when all five masters exist", () => {
  const counts = { projects: 3, categories: 1, materials: 5, vendors: 2, warehouses: 1 };
  assert.deepEqual(setupCompletion(counts), { completed: 5, total: 5, ready: true });
});

test("master creation actions each require their own existing permission", () => {
  assert.deepEqual(setupSteps(empty).map(x => x.permission), [
    "projects.manage", "materials.manage", "materials.manage", "vendors.manage", "warehouses.manage",
  ]);
});
