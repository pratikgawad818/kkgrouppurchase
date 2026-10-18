import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const source = readFileSync("public/push-sw.js", "utf8");
function worker(windows = []) {
  const handlers = {},
    shown = [],
    opened = [];
  const self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    location: { origin: "https://erp.test" },
    navigator: {},
    registration: { showNotification: async (title, options) => shown.push({ title, ...options }) },
    clients: { matchAll: async () => windows, openWindow: async (url) => opened.push(url) },
  };
  runInNewContext(source, { self, URL, Promise });
  return {
    shown,
    opened,
    async push(payload) {
      let work;
      handlers.push({ data: { json: () => payload }, waitUntil: (p) => (work = p) });
      await work;
    },
    async click(link) {
      let work;
      handlers.notificationclick({
        notification: { data: { link }, close() {} },
        waitUntil: (p) => (work = p),
      });
      await work;
    },
  };
}
test("one push creates exactly one visible mobile alert and preserves its deduplication tag", async () => {
  const w = worker();
  await w.push({
    title: "Order approval",
    body: "Review order",
    tag: "one",
    link: "/approvals?id=order",
  });
  assert.equal(w.shown.length, 1);
  assert.equal(w.shown[0].tag, "one");
  assert.equal(w.shown[0].data.link, "/approvals?id=order");
});
test("malformed payload still shows a visible fallback notification", async () => {
  const w = worker();
  await w.push(null);
  assert.equal(w.shown[0].title, "KK GROUP ERP");
});
test("a stale app window cannot swallow a notification tap", async () => {
  const w = worker([
    {
      url: "https://erp.test/dashboard",
      navigate: async () => {
        throw new Error("closed");
      },
    },
  ]);
  await w.click("/approvals?kind=purchase_order&id=one");
  assert.equal(w.opened[0], "https://erp.test/approvals?kind=purchase_order&id=one");
});
test("external notification destinations are replaced with the safe dashboard", async () => {
  const w = worker();
  await w.click("https://evil.test");
  assert.equal(w.opened[0], "https://erp.test/dashboard");
});
