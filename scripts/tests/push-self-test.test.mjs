import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
const realRequire = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync("src/lib/push.functions.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function setup({ active = true, claimed = true, delivery = "sent" } = {}) {
  const filters = [],
    delivered = [];
  const chain = {
    middleware() {
      return this;
    },
    inputValidator() {
      return this;
    },
    handler(fn) {
      return fn;
    },
  };
  const admin = {
    from(table) {
      if (table === "push_config")
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: { vapid_private_jwk: {} } }) }),
          }),
        };
      const q = {
        update() {
          return q;
        },
        eq(k, v) {
          filters.push([k, v]);
          return q;
        },
        or(v) {
          filters.push(["rate-limit", v]);
          return q;
        },
        select() {
          return q;
        },
        maybeSingle: async () => ({
          data: claimed
            ? {
                id: "own-device",
                endpoint: "https://fcm.googleapis.com/fcm/send/owned",
                p256dh: "key",
                auth: "auth",
              }
            : null,
          error: null,
        }),
      };
      return q;
    },
  };
  const modules = {
    "@tanstack/react-start": { createServerFn: () => chain },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "@/integrations/supabase/client.server": { supabaseAdmin: admin },
    "@/lib/push-delivery.server": {
      deliverPush: async (...args) => {
        delivered.push(args);
        return delivery;
      },
    },
  };
  const ctx = {
    exports: {},
    require: (name) => modules[name] ?? realRequire(name),
    Date,
    Error,
    Promise,
  };
  runInNewContext(source, ctx);
  const context = {
    userId: "caller",
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: { is_active: active }, error: null }) }),
        }),
      }),
    },
  };
  return {
    filters,
    delivered,
    run: () =>
      ctx.exports.testMyPhoneAlert({
        data: { endpoint: "https://fcm.googleapis.com/fcm/send/owned" },
        context,
      }),
  };
}
test("self-test scopes the atomic rate-limit claim to the authenticated caller and exact device", async () => {
  const e = setup();
  await e.run();
  assert.deepEqual(e.filters.slice(0, 2), [
    ["user_id", "caller"],
    ["endpoint", "https://fcm.googleapis.com/fcm/send/owned"],
  ]);
  assert.match(e.filters[2][1], /^last_test_at.is.null,last_test_at.lt./);
  assert.equal(e.delivered.length, 1);
  assert.equal(e.delivered[0][2].link, "/dashboard");
});
test("inactive staff cannot send a phone test", async () => {
  const e = setup({ active: false });
  await assert.rejects(e.run(), /must be active/);
  assert.equal(e.delivered.length, 0);
});
test("an unowned or rate-limited endpoint never gets a test delivery", async () => {
  const e = setup({ claimed: false });
  await assert.rejects(e.run(), /wait 30 seconds/);
  assert.equal(e.delivered.length, 0);
});
test("provider failure and expired subscription never report successful phone setup", async () => {
  await assert.rejects(setup({ delivery: "failed" }).run(), /could not accept/);
  await assert.rejects(setup({ delivery: "expired" }).run(), /expired/);
});
