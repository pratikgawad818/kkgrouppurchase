import assert from "node:assert/strict";
import test from "node:test";
import { loadCompleteRows } from "../../src/lib/complete-register.ts";

const row = n => ({ id: `inv-${n}`, amount: n + 0.5 });
const simulate = (records, patch) => (start, end) => {
  const data = records.slice(start, end + 1);
  return Promise.resolve(patch ? patch({ data, count: records.length, error: null }, start, end) : { data, count: records.length, error: null });
};

test("reads empty, single and multi-page finance registers without missing invoices", async () => {
  for (const size of [0, 1, 249, 250, 251, 760]) {
    const records = Array.from({ length: size }, (_, i) => row(i));
    const seen = [];
    const result = await loadCompleteRows((start, end) => {
      seen.push([start, end]);
      return simulate(records)(start, end);
    });
    assert.deepEqual(result, records);
    assert.equal(result.reduce((sum, r) => sum + r.amount, 0), records.reduce((sum, r) => sum + r.amount, 0));
    assert.equal(seen.length, Math.max(1, Math.ceil(size / 250)));
  }
});

test("fails closed if PostgREST silently caps a page shorter than the reported total", async () => {
  const records = Array.from({ length: 800 }, (_, i) => row(i));
  await assert.rejects(loadCompleteRows(simulate(records, (response) => ({
    ...response, data: response.data.slice(0, 100),
  }))), /incomplete or was capped/);
});

test("fails closed if the exact count is missing, invalid or changes between pages", async () => {
  const records = Array.from({ length: 300 }, (_, i) => row(i));
  await assert.rejects(loadCompleteRows(simulate(records, r => ({ ...r, count: null }))), /no reliable total count/);
  await assert.rejects(loadCompleteRows(simulate(records, r => ({ ...r, count: NaN }))), /no reliable total count/);
  await assert.rejects(loadCompleteRows(simulate(records, (r, start) => ({ ...r, count: start === 0 ? 300 : 301 }))), /changed during loading/);
});

test("fails closed if the register is too large for safe browser aggregation", async () => {
  const records = Array.from({ length: 11 }, (_, i) => row(i));
  await assert.rejects(loadCompleteRows(simulate(records), { maxRows: 10, pageSize: 5 }), /browser safety limit/);
});

test("fails closed on a failed page or duplicate records", async () => {
  const records = Array.from({ length: 300 }, (_, i) => row(i));
  await assert.rejects(loadCompleteRows(simulate(records, (r, start) => start > 0 ? { ...r, error: { message: "Connection failed" } } : r)), /Connection failed/);
  await assert.rejects(loadCompleteRows(simulate(records, (r, start) => start === 250 ? { ...r, data: [records[249], ...r.data.slice(1)] } : r)), /duplicate or invalid/);
});
