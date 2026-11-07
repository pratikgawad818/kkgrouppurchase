import test from "node:test";
import assert from "node:assert/strict";
import { inr, inrShort, inrCompact, num } from "../../src/lib/format.ts";
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

test("mobile dashboard abbreviates payables without changing financial amounts", () => {
  assert.equal(inrCompact(9_128_554.34), "₹91.29 L");
  assert.equal(inrCompact(10_000_000), "₹1 Cr");
  assert.equal(inrCompact(225_300_000), "₹22.53 Cr");
  assert.equal(inrCompact(100_000), "₹1 L");
  assert.equal(inrCompact(15_423.45), "₹15.42 K");
  assert.equal(inrCompact(975.40), "₹975.4");
  assert.equal(inrCompact(0), "₹0");
  assert.equal(inrCompact(-12_500_000), "-₹1.25 Cr");
  assert.equal(inrCompact(null), "—");
  assert.equal(inrCompact(Number.NaN), "—");

  // Original transaction screens retain the full value and every paise.
  assert.equal(inr(9_128_554.34), "₹91,28,554.34");
  assert.equal(inrShort(225_300_000), "₹22,53,00,000.00");
});
