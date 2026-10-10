import test from "node:test";
import assert from "node:assert/strict";
import { canAccessPage, accessibleNavigation } from "../../src/lib/page-access.ts";

const subject = (role, ...permissions) => ({ roles: [role], permissions: new Set(permissions) });
const owner = subject("super_admin",
  "company.view","projects.view_all","units.view","users.manage","inventory.view",
  "payable.view","payment.view","financial.view","purchase_order.approve",
  "purchase_request.view","purchase_request.edit","purchase_request.create",
  "rfq.view","rfq.create","quotation.view","quotation.create","quotation.compare",
  "vendor_invoice.view","vendor_invoice.create","vendors.view","warehouses.view",
  "materials.view","ledger.view","grn.view","audit.view","purchase_order.view",
);

test("unknown route, no role and missing permissions fail closed", () => {
  assert.equal(canAccessPage("/invented/confidential", owner), false);
  assert.equal(canAccessPage("/dashboard", { roles: [], permissions: new Set(["users.manage"]) }), false);
  assert.equal(canAccessPage("/finance/payments", subject("site_engineer","inventory.view")), false);
  assert.equal(canAccessPage("/settings/users", subject("auditor","users.manage")), false);
});

test("boss can see read-only management locations and cost reports but cannot open operational pages", () => {
  const viewer = subject("auditor",
    "inventory.view","payable.view","payment.view","financial.view","company.view",
    "purchase_order.view","grn.view","vendor_invoice.view","users.manage",
  );
  const allowed = [
    "/management","/inventory/stock","/inventory/stock-movements",
    "/inventory/material-consumption","/reports/project-cost-control",
    "/finance/payables","/finance/payments",
  ];
  for (const url of allowed) assert.equal(canAccessPage(url, viewer), true, url);
  for (const url of [
    "/dashboard","/approvals","/projects","/settings/users","/settings/company",
    "/procurement/purchase-requests/new", "/inventory/material-issues",
    "/inventory/material-issues/123","/finance/vendor-invoices/new",
    "/finance/vendor-invoices/123","/procurement/purchase-orders/123",
  ]) assert.equal(canAccessPage(url, viewer), false, url);
  assert.equal(canAccessPage("/management", subject("auditor", "inventory.view")), false);
});

test("finance manager and site staff get their own modules, not others", () => {
  const accounts = subject("accountant","payable.view","payment.view","payment.record","vendor_invoice.view");
  assert.equal(canAccessPage("/finance/payments", accounts), true);
  assert.equal(canAccessPage("/finance/payables", accounts), true);
  assert.equal(canAccessPage("/finance/vendor-invoices/new", accounts), false);
  assert.equal(canAccessPage("/materials", accounts), false);

  const store = subject("store_manager","inventory.view","purchase_request.view");
  assert.equal(canAccessPage("/inventory/stock", store), true);
  assert.equal(canAccessPage("/finance/payments", store), false);
  assert.equal(canAccessPage("/settings/users", store), false);
});

test("manually typed /new /edit and sensitive nested pages require action permissions", () => {
  const viewer = subject("purchase_manager", "purchase_request.view","rfq.view",
    "quotation.view","vendor_invoice.view");
  assert.equal(canAccessPage("/procurement/purchase-requests/abc", viewer), true);
  assert.equal(canAccessPage("/procurement/purchase-requests/abc/edit", viewer), false);
  assert.equal(canAccessPage("/procurement/purchase-requests/new", viewer), false);
  assert.equal(canAccessPage("/procurement/rfqs/abc", viewer), true);
  assert.equal(canAccessPage("/procurement/rfqs/abc/quotation", viewer), false);
  assert.equal(canAccessPage("/procurement/rfqs/new", viewer), false);
  assert.equal(canAccessPage("/finance/vendor-invoices/new", viewer), false);
  assert.equal(canAccessPage("/finance/vendor-invoices/abc", viewer), true);
  assert.equal(canAccessPage("/procurement/purchase-requests/abc/edit", owner), true);
  assert.equal(canAccessPage("/procurement/rfqs/abc/quotation", owner), true);
  assert.equal(canAccessPage("/procurement/rfqs/abc/compare", owner), true);
});

test("navigation and direct URL authorization share the identical rules", () => {
  const nav = [
    {to:"/dashboard"}, {to:"/management"}, {to:"/settings/users"},
    {to:"/inventory/stock"}, {to:"/finance/payments"}, {to:"/approvals"},
  ];
  const v = subject("auditor","inventory.view","payable.view","payment.view","financial.view");
  assert.deepEqual(accessibleNavigation(nav,v).map(x=>x.to),["/management","/inventory/stock","/finance/payments"]);
  const store=subject("store_manager","inventory.view");
  assert.deepEqual(accessibleNavigation(nav,store).map(x=>x.to),["/dashboard","/inventory/stock"]);
});
