import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { directorWebhookConfig, parseDirectorReceipts, verifyMetaSignature,
  handleDirectorWebhook, MAX_WEBHOOK_BYTES } from "../../src/lib/director-whatsapp-webhook.ts";
import { directorAlertLabel } from "../../src/lib/director-whatsapp-status.ts";

const env = { KK_DIRECTOR_WA_WEBHOOK_ENABLED: "true",
  KK_DIRECTOR_WA_APPROVED_PHONE_ID: "123456789012345", KK_DIRECTOR_WA_APPROVED_WABA_ID: "123456789012346",
  KK_DIRECTOR_WA_META_APP_SECRET: "synthetic-secret-".repeat(3),
  KK_DIRECTOR_WA_WEBHOOK_VERIFY_TOKEN: "synthetic-verify-".repeat(3) };
const config = directorWebhookConfig(env);
const receipt = { id: "wamid.receipt.123", recipient_id: "919876543210", status: "delivered", timestamp: "1791722017" };
const payload = (statuses = [receipt]) => ({ object: "whatsapp_business_account", entry: [
  { id: config.wabaId, changes: [{ field: "messages", value: {
    metadata: { phone_number_id: config.phoneId }, statuses,
    messages: [{ text: { body: "APPROVE: private text must be ignored" } }],
  } }] },
] });
function signed(body = JSON.stringify(payload()), signature) {
  return new Request("https://erp.example/api/director-whatsapp-webhook", { method: "POST", body,
    headers: { "x-hub-signature-256": signature ?? "sha256=" + createHmac("sha256", config.appSecret).update(body).digest("hex") } });
}

test("exact byte signature rejects tampering, missing and malformed headers", () => {
  const bytes = new TextEncoder().encode("{\"é\":1}\n");
  const signature = "sha256=" + createHmac("sha256", config.appSecret).update(bytes).digest("hex");
  assert.equal(verifyMetaSignature(bytes, signature, config.appSecret), true);
  assert.equal(verifyMetaSignature(new TextEncoder().encode("{\"é\":1}"), signature, config.appSecret), false);
  for (const sig of [null, "", "sha256=00", "sha1=" + "a".repeat(64)]) {
    assert.equal(verifyMetaSignature(bytes, sig, config.appSecret), false);
  }
});
test("verification challenge is private and disabled by default", async () => {
  const url = new URL("https://erp.example/api/director-whatsapp-webhook");
  url.search = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": config.verifyToken, "hub.challenge": "12345" });
  const response = await handleDirectorWebhook(new Request(url), env, async () => assert.fail("GET must not write"));
  assert.equal(response.status, 200); assert.equal(await response.text(), "12345");
  url.searchParams.set("hub.verify_token", "wrong");
  assert.equal((await handleDirectorWebhook(new Request(url), env, async () => {})).status, 401);
  assert.equal((await handleDirectorWebhook(signed(), {}, async () => {})).status, 503);
});
test("only allowlisted sender receipts persist; inbound content never becomes a vote", () => {
  const parsed = parseDirectorReceipts(payload([receipt, receipt]), config);
  assert.deepEqual(parsed, [{ message_id: receipt.id, recipient_id: receipt.recipient_id, status: "delivered",
    provider_timestamp: 1791722017, error_code: null }]);
  const other = payload(); other.entry[0].id = "987654321012345";
  assert.deepEqual(parseDirectorReceipts(other, config), []);
  other.entry[0].id = config.wabaId; other.entry[0].changes[0].value.metadata.phone_number_id = "987654321012345";
  assert.deepEqual(parseDirectorReceipts(other, config), []);
  const incoming = payload(); delete incoming.entry[0].changes[0].value.statuses;
  assert.deepEqual(parseDirectorReceipts(incoming, config), []);
  assert.equal(parseDirectorReceipts(payload([{...receipt,status:"failed",errors:[{code:131026,message:"private content"}]}]), config)[0].error_code, "131026");
});
test("malformed relevant receipt aborts the batch; unknown statuses are ignored", () => {
  for (const change of [{ id: "not-a-wamid" }, { recipient_id: "+919876543210" }, { timestamp: "NaN" }, { timestamp: "0" }]) {
    assert.throws(() => parseDirectorReceipts(payload([receipt, {...receipt,...change}]), config));
  }
  assert.deepEqual(parseDirectorReceipts(payload([{...receipt,status:"future_status"}]), config), []);
  assert.throws(() => parseDirectorReceipts(payload(Array.from({length:101},(_,i)=>({...receipt,id:"wamid."+i}))), config));
});
test("signed POST acknowledges only durable storage; failures ask Meta to retry", async () => {
  let count = 0;
  const response = await handleDirectorWebhook(signed(), env, async receipts => { count++; assert.equal(receipts.length,1); });
  assert.equal(response.status,200); assert.equal(count,1);
  assert.equal((await handleDirectorWebhook(signed(), env, async () => { throw Error("synthetic DB outage"); })).status,503);
  assert.equal((await handleDirectorWebhook(signed("{}", "sha256="+"a".repeat(64)), env, async () => assert.fail())).status,401);
  assert.equal((await handleDirectorWebhook(signed("{"), env, async () => assert.fail())).status,400);
  assert.equal((await handleDirectorWebhook(signed("x".repeat(MAX_WEBHOOK_BYTES+1)), env, async () => assert.fail())).status,413);
});
test("approval UI distinguishes send, delivery, read and decisions", () => {
  assert.match(directorAlertLabel("accepted"), /unconfirmed/);
  assert.equal(directorAlertLabel("accepted","read"), "Read on WhatsApp");
  assert.equal(directorAlertLabel("accepted","failed","131026"), "Delivery failed · Meta code 131026");
  assert.match(directorAlertLabel("unknown","read"), /unknown/);
});
