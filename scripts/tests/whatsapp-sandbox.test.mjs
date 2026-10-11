import test from "node:test";
import assert from "node:assert/strict";
import { SANDBOX, getTestConfig, parseTestRecipient, sendHelloWorld } from "../../src/lib/whatsapp-sandbox.ts";
const good = {
  KK_WHATSAPP_TEST_ENABLED: "true",
  KK_WHATSAPP_TEST_ACCESS_TOKEN: "testing-only-token",
  KK_WHATSAPP_TEST_RECIPIENT: "+919876543210",
  KK_WHATSAPP_TEST_PHONE_NUMBER_ID: SANDBOX.phoneNumberId,
  KK_WHATSAPP_TEST_WABA_ID: SANDBOX.wabaId,
};
test("missing secret, mismatched Meta account, invalid recipient, or disabled mode fail closed", () => {
  for (const env of [{}, { ...good, KK_WHATSAPP_TEST_ENABLED: "false" },
    { ...good, KK_WHATSAPP_TEST_PHONE_NUMBER_ID: "production" },
    { ...good, KK_WHATSAPP_TEST_WABA_ID: "production" },
    { ...good, KK_WHATSAPP_TEST_ACCESS_TOKEN: "" },
    { ...good, KK_WHATSAPP_TEST_RECIPIENT: "9876543210" }]) {
    assert.equal(getTestConfig(env).ready, false);
  }
  assert.equal(getTestConfig(good).ready, true);
});
test("test recipient is strictly E.164; masked UI string hides subscriber digits", () => {
  assert.equal(parseTestRecipient("+919876543210"), "919876543210");
  for (const bad of ["9876543210", "+91 9876543210", "", undefined, "00919876543210", "+0"]) {
    assert.equal(parseTestRecipient(bad), null);
  }
  assert.ok(getTestConfig(good).maskedRecipient.endsWith("3210"));
  assert.ok(!getTestConfig(good).maskedRecipient.includes("987654"));
});
test("sends only fixed hello_world template to configured verified recipient and TEST phone ID", async () => {
  let calls = 0;
  const fetcher = async (url, opts) => {
    calls++;
    assert.equal(url, "https://graph.facebook.com/v25.0/" + SANDBOX.phoneNumberId + "/messages");
    assert.equal(opts.method, "POST");
    assert.deepEqual(JSON.parse(opts.body), {
      messaging_product: "whatsapp", to: "919876543210", type: "template",
      template: { name: "hello_world", language: { code: "en_US" } },
    });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.test123" }] }), { status: 200 });
  };
  assert.equal(await sendHelloWorld(getTestConfig(good), fetcher), "wamid.test123");
  assert.equal(calls, 1);
});
test("does not send with disabled config or reveal Meta error response body", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response('{"secret":"please-dont-log"}', { status: 401 }); };
  await assert.rejects(sendHelloWorld(getTestConfig({}), fetcher), /disabled or incomplete/);
  assert.equal(calls, 0);
  await assert.rejects(sendHelloWorld(getTestConfig(good), fetcher), err => {
    assert.match(err.message, /credentials/);
    assert.doesNotMatch(err.message, /please-dont-log/);
    return true;
  });
});
