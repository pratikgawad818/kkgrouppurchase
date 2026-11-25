import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("workspace links explicitly preload on intent, not viewport or mount", () => {
  const frame = read("src/components/erp/workspace-frame.tsx");
  const links = frame.match(/<Link\b/g) ?? [];
  assert.ok(links.length > 0);
  assert.equal((frame.match(/<Link\s+preload="intent"/g) ?? []).length, links.length);
  const router = read("src/router.tsx");
  assert.doesNotMatch(router, /defaultPreload\s*:/);
  assert.match(router, /defaultPreloadStaleTime:\s*15_000/);
});

test("preloading preserves authenticated route guard and shell authorization", () => {
  const guard = read("src/routes/_authenticated/route.tsx");
  assert.match(guard, /await getVerifiedRouteUser\(\)/);
  const shell = read("src/routes/_authenticated/_shell.tsx");
  assert.match(shell, /workspaceNavigation\(access\)/);
  assert.match(shell, /canAccessPage\(path, access\)/);
  assert.match(shell, /qc\.clear\(\)/);
});
