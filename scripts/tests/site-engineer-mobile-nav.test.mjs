import test from "node:test";
import assert from "node:assert/strict";
import { mobileWorkspaceNavigation } from "../../src/lib/workspace-navigation.ts";

const groups = [
  { key: "home", label: "Overview", items: [{ to: "/dashboard", label: "Dashboard" }] },
  { key: "purchasing", label: "Procurement", items: [{ to: "/procurement/purchase-requests", label: "Purchase requests" }] },
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
