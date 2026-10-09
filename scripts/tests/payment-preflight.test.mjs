import test from "node:test";
import assert from "node:assert/strict";
import {
  availableAfterScheduled,
  inspectPaymentSchedule,
  inspectAdvanceAdjustment,
  remainingAdvanceAmount,
  checkedAdvanceUsage,
} from "../../src/lib/payment-preflight.ts";

const invoices = [
  { id: "invoice-a", invoice_number: "VI-01", payable: 250 },
  { id: "invoice-b", invoice_number: "VI-02", payable: 75.5 },
];

test("deducts scheduled and approved payment allocations from unpaid balance", () => {
  assert.equal(availableAfterScheduled(500, 120.5), 379.5);
  assert.equal(availableAfterScheduled(30, 90), 0);
  assert.equal(availableAfterScheduled(100, NaN), null);
  assert.equal(availableAfterScheduled(-10, 0), null);
});

test("allocates exact paise without rounding invalid higher precision", () => {
  const x = inspectPaymentSchedule(
    { "invoice-a": "123.45", "invoice-b": "75.5" }, invoices, true,
  );
  assert.deepEqual(x.errors, []);
  assert.equal(x.total, 198.95);
  assert.deepEqual(x.allocations, [
    { invoice_id: "invoice-a", amount: 123.45 },
    { invoice_id: "invoice-b", amount: 75.5 },
  ]);
});

test("cannot schedule amounts greater than available after pending payment reservations", () => {
  const x = inspectPaymentSchedule(
    { "invoice-a": "250.01" }, invoices, true,
  );
  assert.equal(x.allocations.length, 0);
  assert.match(x.errors.join(" "), /only ₹250.00/);
});

test("failed, pending or truncated availability lookup blocks scheduling", () => {
  for (const state of [false]) {
    const x = inspectPaymentSchedule({ "invoice-a": "5" }, invoices, state);
    assert.equal(x.total, 0);
    assert.match(x.errors[0], /could not be verified/);
  }
});

test("stale invoice selections are rejected instead of being silently omitted", () => {
  const x = inspectPaymentSchedule({ "old-invoice": "1" }, invoices, true);
  assert.equal(x.allocations.length, 0);
  assert.match(x.errors[0], /no longer available/);
});

test("rejects amounts with negative, nonfinite, or excessive decimal precision", () => {
  for (const value of ["-1", "1.001", "Infinity", "NaN", "1e5", "+1", "  ", "1.2.3"]) {
    if (value.trim() === "") continue;
    const x = inspectPaymentSchedule({ "invoice-a": value }, invoices, true);
    assert.ok(x.errors.length > 0, `Expected error for ${value}`);
    assert.equal(x.allocations.length, 0);
  }
});

test("a blank or explicit zero is not silently sent as a payment allocation", () => {
  const x = inspectPaymentSchedule({ "invoice-a": "0", "invoice-b": "" }, invoices, true);
  assert.equal(x.total, 0);
  assert.match(x.errors[0], /positive amount/);
});

test("does not fabricate availability for unknown balances", () => {
  const x = inspectPaymentSchedule({ "invoice-a": "10" },
    [{ id: "invoice-a", invoice_number: "VI-01", payable: NaN }], true);
  assert.match(x.errors[0], /unavailable/);
});




test("advance usage totals in integer paise and rejects corrupt adjustment rows", () => {
  const usage = checkedAdvanceUsage([
    { advance_payment_id: "adv-1", amount: 0.1 },
    { advance_payment_id: "adv-1", amount: 0.2 },
    { advance_payment_id: "adv-2", amount: 25 },
  ]);
  assert.equal(usage.get("adv-1"), 0.3);
  assert.equal(usage.get("adv-2"), 25);
  assert.equal(remainingAdvanceAmount(100.5, usage.get("adv-2")), 75.5);
  assert.equal(remainingAdvanceAmount(10, 10.01), null);
  assert.equal(remainingAdvanceAmount(NaN, 0), null);
  assert.throws(() => checkedAdvanceUsage([{ advance_payment_id: "adv", amount: -1 }]), /invalid entry/);
  assert.throws(() => checkedAdvanceUsage([{ advance_payment_id: "adv", amount: 0.001 }]), /invalid entry/);
});

test("advance adjustment preflight rejects invisible, stale and excessive claims", () => {
  assert.deepEqual(inspectAdvanceAdjustment("10.25", 30, 25, true), { amount: 10.25, error: null });
  for (const amount of ["-1", "", "0", "0.001", "1e3", "Infinity", "NaN"]) {
    assert.ok(inspectAdvanceAdjustment(amount, 30, 25, true).error, amount);
  }
  assert.match(inspectAdvanceAdjustment("10", 30, 25, false).error, /verify the latest/);
  assert.match(inspectAdvanceAdjustment("10", 30, null, true).error, /Select an invoice/);
  assert.match(inspectAdvanceAdjustment("30", 20, 100, true).error, /advance has only/);
  assert.match(inspectAdvanceAdjustment("30", 100, 20, true).error, /invoice has only/);
  assert.match(inspectAdvanceAdjustment("10", 100, NaN, true).error, /balance is unavailable/);
});
