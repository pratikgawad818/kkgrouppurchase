import test from "node:test";
import assert from "node:assert/strict";
import { inr, inrShort, num } from "../../src/lib/format.ts";
import { canAccessPage } from "../../src/lib/page-access.ts";

test("all financial screens show exact rupees and paise, never auto-round to the nearest rupee", () => {
  assert.equal(inr(12450.75), "₹12,450.75");
  assert.equal(inr("0.09"), "₹0.09");
  assert.equal(inr(-13.55), "-₹13.55");
  assert.equal(inr(100), "₹100.00");
  assert.equal(inrShort(12345678.99), "₹1,23,45,678.99");
  assert.equal(inrShort(123456.78), "₹1,23,456.78");
});
test("construction measurements can show three decimal quantity precision", () => {
  assert.equal(num(12.345), "12.345");
  assert.equal(num(1500.125), "1,500.125");
  assert.equal(num(17), "17");
});
test("old-bill entry requires the create permission; reading invoice details remains separate", () => {
  const acc = (perms) => ({ roles: ["accountant"], permissions: new Set(perms) });
  assert.equal(canAccessPage("/finance/vendor-invoices/opening", acc(["vendor_invoice.view"])), false);
  assert.equal(canAccessPage("/finance/vendor-invoices/opening", acc(["vendor_invoice.create"])), true);
  assert.equal(canAccessPage("/finance/vendor-invoices/example-id", acc(["vendor_invoice.view"])), true);
  assert.equal(canAccessPage("/finance/vendor-invoices/new", acc(["vendor_invoice.view"])), false);
});
