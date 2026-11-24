import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = "src/routes/_authenticated/_shell/";
const common = readFileSync("src/components/erp/common.tsx", "utf8");
const expected = {
  "finance.vendor-invoices.$id.tsx": "/finance/vendor-invoices",
  "finance.payments.$id.tsx": "/finance/payments",
  "inventory.delivery-challans.$id.tsx": "/inventory/delivery-challans",
  "inventory.goods-received.$id.tsx": "/inventory/goods-received",
  "inventory.material-issues.$id.tsx": "/inventory/material-issues",
  "procurement.purchase-orders.$id.tsx": "/procurement/purchase-orders",
  "procurement.purchase-requests.$id.index.tsx": "/procurement/purchase-requests",
  "procurement.rfqs.$id.index.tsx": "/procurement/rfqs",
  "procurement.rfqs.$id.compare.tsx": "/procurement/rfqs",
  "procurement.rfqs.$id.quotation.tsx": "/procurement/rfqs",
  "procurement.purchase-requests.$id.edit.tsx": "/procurement/purchase-requests",
  "procurement.purchase-requests.new.tsx": "/procurement/purchase-requests",
  "procurement.rfqs.new.tsx": "/procurement/rfqs",
  "finance.vendor-invoices.new.tsx": "/finance/vendor-invoices",
  "finance.vendor-invoices.opening.tsx": "/finance/vendor-invoices",
};

test("Go Back preserves router navigation history with safe list-page fallback", () => {
  assert.match(common, /useCanGoBack, useRouter/);
  assert.match(common, /if \(canGoBack\)\s*\{\s*router\.history\.back\(\)/);
  assert.match(common, /void router\.navigate\(\{ to: fallbackTo \}\)/);
  assert.match(common, /aria-label="Go Back"/);
  assert.match(common, /<ArrowLeft/);
  assert.match(common, /backTo\?: WorkspaceBackDestination/);
  assert.match(common, /<WorkspaceGoBack fallbackTo=\{backTo\}/);
});

test("All document details and relevant forms expose a consistent Go Back control", () => {
  for (const [filename, fallback] of Object.entries(expected)) {
    const code = readFileSync(root + filename, "utf8");
    assert.ok(
      code.includes(`<PageHeader backTo="${fallback}"`),
      `${filename}: expected backTo=${fallback}`,
    );
    assert.match(common, new RegExp(`\\|${fallback.replaceAll("/", "\\/")}`));
  }
});

test("Go Back does not alter finance/procurement actions or add unsafe window history handling", () => {
  assert.doesNotMatch(common, /window\.history\.back\(\)/);
  assert.doesNotMatch(common, /document\.referrer/);
  assert.doesNotMatch(common, /window\.location/);
  const invoice = readFileSync(root + "finance.vendor-invoices.$id.tsx", "utf8");
  assert.match(invoice, /View invoice/);
  assert.match(invoice, /Download invoice/);
  assert.match(invoice, /Reject/);
});
