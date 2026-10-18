import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/lib/web-push.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function environment({
  permission = "granted",
  missing = false,
  saveError = null,
  ios = false,
  standalone = false,
} = {}) {
  const calls = { subscribe: 0, unsubscribe: 0, save: 0, prompt: 0, remove: 0 };
  const storage = new Map();
  const sub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/test",
    expirationTime: null,
    options: {},
    toJSON: () => ({ keys: { p256dh: "key", auth: "auth" } }),
    unsubscribe: async () => {
      calls.unsubscribe++;
      current = null;
      return true;
    },
  };
  let current = missing ? null : sub;
  const reg = {
    active: {},
    pushManager: {
      getSubscription: async () => current,
      subscribe: async () => {
        calls.subscribe++;
        return (current = sub);
      },
    },
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    rpc: async () => {
      calls.save++;
      return { error: saveError };
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: "device" }, error: null }) }),
      }),
      delete: () => ({
        eq: async () => {
          calls.remove++;
          return { error: null };
        },
      }),
    }),
  };
  const window = {
    isSecureContext: true,
    PushManager: {},
    Notification: {},
    matchMedia: () => ({ matches: standalone }),
  };
  window.top = window;
  window.self = window;
  const notification = {
    permission,
    requestPermission: () => {
      calls.prompt++;
      return Promise.resolve("granted");
    },
  };
  const context = {
    exports: {},
    require: () => ({ supabase }),
    window,
    navigator: {
      userAgent: ios ? "iPhone" : "Chrome",
      serviceWorker: { getRegistration: async () => reg, register: async () => reg },
    },
    Notification: notification,
    localStorage: {
      getItem: (k) => storage.get(k),
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    Uint8Array,
    Promise,
    Date,
    setTimeout,
    clearTimeout,
  };
  runInNewContext(source, context);
  return { api: context.exports, calls, context };
}

test("enabling and reconciling keep a healthy endpoint instead of churning subscriptions", async () => {
  const e = environment();
  assert.equal(await e.api.enablePush(), "on");
  assert.equal(await e.api.ensureDirectorPush(true), "on");
  assert.equal(e.calls.subscribe, 0);
  assert.equal(e.calls.unsubscribe, 0);
  assert.equal(e.calls.save, 2);
});
test("simultaneous focus and tap create only one subscription", async () => {
  const e = environment({ missing: true });
  await Promise.all([e.api.enablePush(), e.api.enablePush()]);
  assert.equal(e.calls.subscribe, 1);
  assert.equal(e.calls.save, 1);
});
test("failed account registration removes a newly created phantom endpoint", async () => {
  const e = environment({ missing: true, saveError: new Error("device limit") });
  await assert.rejects(e.api.enablePush(), /device limit/);
  assert.equal(e.calls.unsubscribe, 1);
});
test("explicit off survives Director reconciliation and does not prompt", async () => {
  const e = environment();
  await e.api.disablePush();
  assert.equal(await e.api.ensureDirectorPush(true), "off");
  assert.equal(e.calls.subscribe, 0);
  assert.equal(e.calls.prompt, 0);
});
test("automatic reconciliation never requests first-time permission", async () => {
  const e = environment({ permission: "default", missing: true });
  assert.equal(await e.api.ensureDirectorPush(true), "off");
  assert.equal(e.calls.prompt, 0);
});
test("a tap requests permission before awaiting network work", async () => {
  const e = environment({ permission: "default", missing: true });
  const pending = e.api.enablePush();
  assert.equal(e.calls.prompt, 1);
  await pending;
});
test("explicit repair renews a broken endpoint exactly once", async () => {
  const e = environment();
  assert.equal(await e.api.enablePush(true), "on");
  assert.equal(e.calls.unsubscribe, 1);
  assert.equal(e.calls.subscribe, 1);
});
test("iOS needs the Home Screen app even when APIs exist in the browser", () => {
  assert.equal(environment({ ios: true }).api.pushSupport(), "install-first");
  assert.equal(environment({ ios: true, standalone: true }).api.pushSupport(), null);
});
