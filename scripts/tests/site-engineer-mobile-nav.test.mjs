import test from "node:test";
import assert from "node:assert/strict";
import { mobileWorkspaceNavigation, siteEngineerMoreQuickLinks, workspaceNavigation } from "../../src/lib/workspace-navigation.ts";
import { readFileSync } from "node:fs";

const groups = [
  { key: "home", label: "Overview", items: [{ to: "/dashboard", label: "Dashboard" }] },
  { key: "purchasing", label: "Procurement", items: [
    { to: "/procurement/purchase-requests", label: "Purchase requests" },
    { to: "/procurement/purchase-orders", label: "Purchase orders" },
  ] },
  { key: "stock", label: "Inventory", items: [
    { to: "/inventory/stock", label: "Stock on hand" },
    { to: "/inventory/delivery-challans", label: "Delivery challans" },
    { to: "/inventory/goods-received", label: "Goods received" },
  ] },
];

test("site engineer bottom bar exposes receiving and challans adjacent without redundant purchasing", () => {
  const bottom = mobileWorkspaceNavigation(groups, false, true);
  assert.deepEqual(bottom.map((item) => [item.key, item.to]), [
    ["home", "/dashboard"],
    ["receiving", "/inventory/goods-received"],
    ["challans", "/inventory/delivery-challans"],
    ["stock", "/inventory/stock"],
  ]);
  assert.ok(!bottom.some((item) => item.key === "purchasing"));
});

test("site engineer navigation never surfaces shortcuts that permission filtering removed", () => {
  const restricted = groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.to !== "/inventory/delivery-challans"),
  }));
  const bottom = mobileWorkspaceNavigation(restricted, false, true);
  assert.deepEqual(bottom.map((item) => item.key), ["home", "receiving", "stock"]);
});

test("other roles keep their existing bottom bar choices", () => {
  assert.deepEqual(mobileWorkspaceNavigation(groups).map((item) => item.key), ["home", "purchasing", "stock"]);
  assert.deepEqual(mobileWorkspaceNavigation(groups, true, true).map((item) => item.key), ["home", "purchasing"]);
});


test("Site Engineer mobile More opens existing Small Expense screen directly", () => {
  const access = {
    roles: ["site_engineer"],
    permissions: new Set(["small_expense.create", "purchase_request.view", "purchase_order.view", "grn.view", "inventory.view"]),
  };
  const authorized = workspaceNavigation(access);
  const quick = siteEngineerMoreQuickLinks(authorized, true);
  assert.deepEqual(quick, [{ to: "/finance/small-expenses", label: "Small Expense" }]);
  assert.equal(authorized.some(group => group.items.some(item => item.to === quick[0].to)), true);
  const frame = readFileSync(new URL("../../src/components/erp/workspace-frame.tsx", import.meta.url), "utf8");
  assert.match(frame, /const moreQuickLinks = siteEngineerMoreQuickLinks\(groups, isSiteEngineer\)/);
  assert.match(frame, /moreQuickLinks\.map\(\(item\) => \(\s*<Link/);
  assert.match(frame, /<Receipt aria-hidden \/>/);
  assert.match(frame, /setMenuOpen\(false\)/);
});

test("More shortcut is permission-gated and never grants other finance pages", () => {
  const noSmallExpense = workspaceNavigation({
    roles: ["site_engineer"],
    permissions: new Set(["purchase_request.view", "purchase_order.view", "grn.view"]),
  });
  assert.deepEqual(siteEngineerMoreQuickLinks(noSmallExpense, true), []);
  assert.deepEqual(siteEngineerMoreQuickLinks(workspaceNavigation({
    roles: ["site_engineer"], permissions: new Set(["small_expense.create"]),
  }), false), []);
  const assigned = workspaceNavigation({
    roles: ["site_engineer"], permissions: new Set(["small_expense.create"]),
  });
  const quick = siteEngineerMoreQuickLinks(assigned, true);
  assert.equal(quick.length, 1);
  assert.ok(assigned.flatMap(group=>group.items).every(item=>
    !["/finance/payments","/finance/vendor-invoices","/finance/payables","/finance/vendor-ledger"].includes(item.to)));
  assert.equal(mobileWorkspaceNavigation(groups,false,true).length,4,"bottom bar must remain unchanged");
});
