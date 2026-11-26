import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCompleteRows } from "../../src/lib/complete-register.ts";
const page = readFileSync("src/routes/_authenticated/_shell/inventory.material-issues.index.tsx", "utf8");

test("material issue stock is fetched only for the selected eligible warehouse", () => {
  assert.ok(page.includes('queryKey: ["material-issue-stock", warehouseId]'));
  assert.ok(page.includes('enabled: show && eligibleWarehouse && context.isSuccess'));
  assert.ok(page.includes('.eq("warehouse_id", warehouseId).gt("quantity_on_hand", 0)'));
  assert.ok(page.includes('.order("material_id").range(start,end)'));
  assert.doesNotMatch(page, /\.limit\((1000|3000)\)|\.slice\(0, 100\)/);
  assert.ok(page.includes('id:row.material_id'));
});
test("count-checked stock paging supports more than the old warehouse stock cap", async () => {
  const rows = Array.from({length: 3101}, (_, i) => ({id: "material-" + i, quantity_on_hand: 1}));
  const actual = await loadCompleteRows(async (start,end) => ({
    data: rows.slice(start,end+1), count: rows.length, error: null,
  }));
  assert.deepEqual(actual, rows);
});
test("all entered quantities remain available across search and pages; posting fails closed", () => {
  assert.ok(page.includes('materials.slice(visibleMaterialPage * PAGE,(visibleMaterialPage+1)*PAGE)'));
  assert.ok(page.includes('const lines = stock.flatMap'));
  assert.ok(page.includes('Selected material is no longer available'));
  assert.ok(page.includes('!warehouseStock.isSuccess || warehouseStock.isFetching'));
  assert.ok(page.includes('x.project_id === projectId'));
  assert.ok(page.includes('qty > Number(x.quantity_on_hand)'));
  assert.ok(page.includes('supabase.rpc("record_material_issue"'));
  assert.ok(page.includes('"stock-ledger","material-issue-stock"'));
});
