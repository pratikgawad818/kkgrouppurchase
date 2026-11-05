import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { canAccessPage } from "../../src/lib/page-access.ts";
import { WORKSPACE_NAV } from "../../src/lib/workspace-navigation.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const routeTree = read("src/routeTree.gen.ts");
const fullPaths = [...new Set([...routeTree.matchAll(/fullPath:\s*['"]([^'"]+)['"]/g)].map(m => m[1]))];
const normalize = path => path.length > 1 ? path.replace(/\/+$/, "") : path;
const declared = new Set(fullPaths.map(normalize));

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith(".gen.ts")) yield full;
  }
}

test("all workspace navigation destinations exist as generated TanStack routes", () => {
  for (const group of WORKSPACE_NAV) for (const item of group.items) {
    assert.ok(declared.has(normalize(item.to)), group.label + ": missing page " + item.to);
  }
});

test("every literal internal navigation destination resolves to a generated page", () => {
  let checked = 0;
  for (const path of files(join(root, "src"))) {
    const content = readFileSync(path, "utf8");
    // Safe, deliberately narrow static routes. Dynamic values are validated by
    // TanStack Router's TypeScript route types at build time.
    const patterns = [
      /<Link\b[^>]*\bto\s*=\s*["'](\/[^"']+)["']/gs,
      /\b(?:navigate|nav)\s*\(\s*\{\s*to:\s*["'](\/[^"']+)["']/gs,
      /\bhref\s*=\s*["'](\/[^"']+)["']/gs,
    ];
    for (const regex of patterns) for (const match of content.matchAll(regex)) {
      const target = match[1].split("?")[0].split("#")[0];
      if (target.startsWith("//") || target.startsWith("/api/")) continue;
      assert.ok(declared.has(normalize(target)),
        "Broken literal route " + target + " in " + relative(root, path));
      checked++;
    }
  }
  assert.ok(checked > 80, "Navigation scan unexpectedly missed most links");
});

test("all generated staff pages remain classified by the central permission boundary", () => {
  const access = {
    roles: ["super_admin"],
    // Synthetic test user with all page permissions. A missing route rule is
    // an error even if its page happens to compile.
    permissions: new Set(
      [...read("src/lib/page-access.ts").matchAll(/["']([a-z_]+\.[a-z_]+)["']/g)].map(m => m[1]),
    ),
  };
  const excluded = new Set(["/", "/auth", "/reset-password"]);
  let count = 0;
  for (const original of fullPaths) {
    const path = normalize(original);
    if (excluded.has(path) || path.startsWith("/api/") || path.startsWith("/lovable/")) continue;
    assert.ok(canAccessPage(path.replaceAll("$id", "sample-document"), access),
      "Unclassified staff route: " + original);
    count++;
  }
  assert.ok(count > 40, "Unexpected drop in audited staff routes");
});
