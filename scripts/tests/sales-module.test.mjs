import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canAccessPage } from "../../src/lib/page-access.ts";
import { workspaceNavigation } from "../../src/lib/workspace-navigation.ts";

const access = (role, permissions=[]) => ({ roles: [role], permissions: new Set(permissions) });
const manager = access("director", ["units.view"]);
const senior = access("senior_sales_executive", ["units.view", "sales.bookings","sales.collections"]);

test("Flat Inventory appears only inside Sales, never Projects menu", () => {
  const nav = workspaceNavigation(manager);
  const sales = nav.find(group => group.key === "sales");
  assert.ok(sales);
  assert.deepEqual(sales.items.map(item => item.to), ["/sales", "/units"]);
  assert.equal(nav.find(group => group.key === "projects")?.items.some(item => item.to === "/units"), false);
});
test("Sales navigation and deep routes are visible only to approved three roles", () => {
  for (const user of [manager, senior, access("super_admin", ["units.view"])]) {
    assert.equal(canAccessPage("/sales", user), true);
    assert.equal(canAccessPage("/units", user), true);
  }
  for (const role of ["site_engineer","purchase_manager","accounts_manager","sales_manager","sales_executive"]) {
    assert.equal(canAccessPage("/sales", access(role,["units.view","sales.bookings","sales.collections"])), false);
    assert.equal(canAccessPage("/units", access(role,["units.view"])), false);
  }
});
test("Senior Sales Executive cannot access procurement and finance using Sales-only rights", () => {
  for (const path of ["/finance/payments","/procurement/purchase-orders","/settings/users",
    "/finance/small-expenses","/inventory/stock"]) {
    assert.equal(canAccessPage(path, senior), false, path);
  }
});
test("sales database migration has separate verified receipt ledger and restricted operations", () => {
  const sql = readFileSync("drizzle/migrations/0085_property_sales_bookings_receipts.sql","utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.property_sales/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.property_sale_receipts/);
  assert.match(sql, /WHERE status='verified'/);
  assert.match(sql, /WHERE status<>'cancelled'/);
  assert.match(sql, /IF NOT public\.sales_manager\(\)/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /CREATE POLICY "Accessible property sales"/);
  assert.match(sql, /GRANT SELECT ON public\.property_sales/);
  assert.doesNotMatch(sql, /GRANT (?:ALL|INSERT|UPDATE|DELETE) ON public\.property_sales/);
});
