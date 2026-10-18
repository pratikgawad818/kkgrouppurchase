import test from "node:test";
import assert from "node:assert/strict";
import { sendPushRequest } from "../../src/lib/push-transport.ts";

test("phone alerts use Worker-supported manual redirects and preserve encrypted payload", async () => {
  const body = new Uint8Array([1, 2, 3]);
  const result = await sendPushRequest(
    { endpoint: "https://fcm.googleapis.com/fcm/send/test", headers: { TTL: "86400" }, body },
    async (url, options) => {
      const request = new Request(url, options);
      assert.equal(request.redirect, "manual");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("TTL"), "86400");
      assert.deepEqual(new Uint8Array(await request.arrayBuffer()), body);
      return new Response(null, { status: 201 });
    },
  );
  assert.equal(result.status, 201);
});

test("provider redirects are not followed or counted as successful delivery", async () => {
  let calls = 0;
  const result = await sendPushRequest(
    { endpoint: "https://fcm.googleapis.com/fcm/send/test", headers: {}, body: "encrypted" },
    async (_, options) => {
      calls++;
      assert.equal(options.redirect, "manual");
      return new Response(null, { status: 307, headers: { Location: "https://example.com" } });
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
});