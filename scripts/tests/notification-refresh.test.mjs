import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createNotificationRefresh, notificationPollInterval } from "../../src/lib/notification-refresh.ts";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test("realtime bursts coalesce and preserve approval refresh intent", async () => {
  const calls = [];
  const batch = createNotificationRefresh(value => calls.push(value), 10);
  batch.schedule();
  batch.schedule(true);
  batch.schedule();
  await sleep(30);
  assert.deepEqual(calls, [true]);
  batch.schedule();
  await sleep(30);
  assert.deepEqual(calls, [true, false]);
  batch.cancel();
});

test("cancelled subscriptions cannot run queued refreshes", async () => {
  const calls = [];
  const batch = createNotificationRefresh(value => calls.push(value), 10);
  batch.schedule(true);
  batch.cancel();
  await sleep(30);
  assert.deepEqual(calls, []);
  batch.schedule();
  await sleep(30);
  assert.deepEqual(calls, [false]);
  batch.cancel();
});

test("healthy connection reduces polling without losing disconnected fallback", () => {
  assert.equal(notificationPollInterval(true), 60_000);
  assert.equal(notificationPollInterval(false), 30_000);
  const bell = readFileSync("src/components/erp/notification-bell.tsx", "utf8");
  assert.ok(bell.includes('refetchIntervalInBackground: false'));
  assert.ok(bell.includes('refetchOnReconnect: true'));
  assert.ok(bell.includes('if (status === "SUBSCRIBED") batch.schedule(true)'));
  assert.ok(bell.includes('batch.schedule(payload.eventType === "INSERT")'));
  assert.ok(bell.includes('[userId, isDirector, qc]'));
  assert.ok(bell.includes('["director-pending-count", userId]'));
  assert.ok(bell.includes('["director-approvals", userId]'));
  assert.ok(bell.includes('document.visibilityState === "visible" ? "active" : "none"'));
  assert.ok(bell.includes('batch.cancel()'));
});
