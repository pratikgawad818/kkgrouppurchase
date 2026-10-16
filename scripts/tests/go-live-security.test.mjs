import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedPushEndpoint,
  internalNotificationLink,
  matchingDispatchSecret,
} from "../../src/lib/push-security.ts";
import { saveAttempt } from "../../src/lib/save-attempt.ts";
import { summarizeDashboardStock } from "../../src/lib/dashboard-stock.ts";

test("push transport accepts only supported provider hosts and paths", () => {
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/token",
    "https://fcm.googleapis.com/wp/token",
    "https://updates.push.services.mozilla.com/wpush/v2/token",
    "https://web.push.apple.com/token",
    "https://wns2-test.notify.windows.com/w/?token=test",
  ])
    assert.equal(allowedPushEndpoint(endpoint), true, endpoint);
  for (const endpoint of [
    "https://127.0.0.1/push",
    "https://[::1]/push",
    "https://169.254.169.254/metadata",
    "https://example.com/push",
    "https://fcm.googleapis.com.evil.test/fcm/send/token",
    "https://fcm.googleapis.com@evil.test/fcm/send/token",
    "https://evil.test@fcm.googleapis.com/fcm/send/token",
    "http://fcm.googleapis.com/fcm/send/token",
    "https://fcm.googleapis.com:444/fcm/send/token",
    "https://fcm.googleapis.com/fcm/send/token#fragment",
    "https://fcm.googleapis.com/not-push/token",
    "bad-url",
  ]) {
    assert.equal(allowedPushEndpoint(endpoint), false, endpoint);
  }
});

test("phone alert links cannot escape the app origin", () => {
  assert.equal(
    internalNotificationLink("/approvals?kind=vendor_payment&id=abc"),
    "/approvals?kind=vendor_payment&id=abc",
  );
  for (const value of ["https://evil.test", "//evil.test", "/\\evil.test", "/\nevil", null, ""])
    assert.equal(internalNotificationLink(value), "/dashboard");
});

test("dispatch secret rejects empty, oversized and mismatched input", () => {
  assert.equal(matchingDispatchSecret("secret", "secret"), true);
  for (const [a, b] of [
    ["", ""],
    ["secret", "secret-extra"],
    ["Secret", "secret"],
    ["a".repeat(513), "a".repeat(513)],
  ])
    assert.equal(matchingDispatchSecret(a, b), false);
});

test("save retries reuse their token while edits and submit actions get a new one", () => {
  let next = 0;
  const id = () => `attempt-${++next}`;
  const first = saveAttempt(null, { amount: 1, submit: false }, id);
  assert.equal(saveAttempt(first, { amount: 1, submit: false }, id), first);
  assert.notEqual(saveAttempt(first, { amount: 2, submit: false }, id).id, first.id);
  assert.notEqual(saveAttempt(first, { amount: 1, submit: true }, id).id, first.id);
});

test("unconfigured and unvalued stock are explicit, and minimum levels count", () => {
  const row = (patch = {}) => ({
    quantity_on_hand: 5,
    total_value: 0,
    items: { minimum_stock: 0, reorder_level: 0, maximum_stock: null },
    ...patch,
  });
  const rows = [
    row(),
    row({ items: { minimum_stock: 6, reorder_level: 0, maximum_stock: null } }),
    row({ quantity_on_hand: 0, items: { minimum_stock: 0, reorder_level: 0, maximum_stock: 10 } }),
  ];
  const result = summarizeDashboardStock(rows);
  assert.equal(result.unconfigured, 1);
  assert.equal(result.unvalued, 2);
  assert.equal(result.low.length, 2);
  assert.throws(() => summarizeDashboardStock([row({ items: null })]), /could not be verified/);
  assert.throws(
    () => summarizeDashboardStock([row({ quantity_on_hand: "NaN" })]),
    /invalid numbers/,
  );
});
