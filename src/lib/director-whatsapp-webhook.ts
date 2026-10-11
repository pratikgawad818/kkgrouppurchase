/** Server-only: verify the exact bytes before inspecting Meta status receipts. */
import { createHmac, timingSafeEqual } from "node:crypto";

type Env = Readonly<Record<string, string | undefined>>;
export type DirectorReceipt = {
  message_id: string;
  recipient_id: string;
  status: "sent" | "delivered" | "read" | "failed";
  provider_timestamp: number;
  error_code: string | null;
};
export const MAX_WEBHOOK_BYTES = 256 * 1024;

export function directorWebhookConfig(env: Env) {
  const phoneId = env["KK_DIRECTOR_WA_APPROVED_PHONE_ID"] ?? "";
  const wabaId = env["KK_DIRECTOR_WA_APPROVED_WABA_ID"] ?? "";
  const appSecret = env["KK_DIRECTOR_WA_META_APP_SECRET"] ?? "";
  const verifyToken = env["KK_DIRECTOR_WA_WEBHOOK_VERIFY_TOKEN"] ?? "";
  return {
    ready: env["KK_DIRECTOR_WA_WEBHOOK_ENABLED"] === "true" &&
      /^\d{8,30}$/.test(phoneId) && /^\d{8,30}$/.test(wabaId) &&
      appSecret.length >= 32 && verifyToken.length >= 32,
    phoneId, wabaId, appSecret, verifyToken,
  };
}

export function verifyMetaSignature(bytes: Uint8Array, signature: string | null, secret: string) {
  if (secret.length < 32 || !signature || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(bytes).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

export function verifyMetaChallenge(url: URL, config: ReturnType<typeof directorWebhookConfig>) {
  const token = Buffer.from(url.searchParams.get("hub.verify_token") ?? "");
  const expected = Buffer.from(config.verifyToken);
  const challenge = url.searchParams.get("hub.challenge");
  if (!config.ready || url.searchParams.get("hub.mode") !== "subscribe" ||
    token.length !== expected.length || !timingSafeEqual(token, expected) ||
    !challenge || !/^\d{1,100}$/.test(challenge)) return null;
  return challenge;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Incoming message content and arbitrary Meta error text are never retained. */
export function parseDirectorReceipts(payload: unknown, config: ReturnType<typeof directorWebhookConfig>) {
  if (!config.ready) throw new Error("Webhook disabled");
  const root = record(payload);
  if (root?.["object"] !== "whatsapp_business_account" || !Array.isArray(root["entry"])) {
    throw new Error("Invalid webhook envelope");
  }
  const receipts: DirectorReceipt[] = [];
  const unique = new Set<string>();
  for (const rawEntry of root["entry"]) {
    const entry = record(rawEntry);
    if (entry?.["id"] !== config.wabaId) continue;
    if (!Array.isArray(entry["changes"])) throw new Error("Invalid changes");
    for (const rawChange of entry["changes"]) {
      const change = record(rawChange), value = record(change?.["value"]);
      if (change?.["field"] !== "messages" ||
        record(value?.["metadata"])?.["phone_number_id"] !== config.phoneId) continue;
      if (value?.["statuses"] === undefined) continue;
      if (!Array.isArray(value["statuses"])) throw new Error("Invalid statuses");
      for (const rawStatus of value["statuses"]) {
        const s = record(rawStatus);
        const id = s?.["id"], recipient = s?.["recipient_id"], status = s?.["status"], timestamp = s?.["timestamp"];
        if (status !== "sent" && status !== "delivered" && status !== "read" && status !== "failed") continue;
        if (typeof id !== "string" || !/^wamid\.[\w.-]{1,290}$/.test(id) ||
          typeof recipient !== "string" || !/^[1-9][0-9]{7,14}$/.test(recipient) ||
          typeof timestamp !== "string" || !/^\d{1,12}$/.test(timestamp) ||
          Number(timestamp) <= 0 || Number(timestamp) > 253402300799) throw new Error("Invalid status receipt");
        const error = Array.isArray(s?.["errors"]) ? record(s["errors"][0])?.["code"] : null;
        const errorCode = status === "failed" && (typeof error === "number" || typeof error === "string") &&
          /^\d{1,10}$/.test(String(error)) ? String(error) : null;
        const key = [id, recipient, status, timestamp].join("|");
        if (unique.has(key)) continue;
        unique.add(key);
        receipts.push({ message_id: id, recipient_id: recipient, status,
          provider_timestamp: Number(timestamp), error_code: errorCode });
        if (receipts.length > 100) throw new Error("Too many receipts");
      }
    }
  }
  return receipts;
}

/** Enforce a byte limit even when Content-Length is absent or inaccurate. */
export async function readWebhookBytes(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WEBHOOK_BYTES) {
        await reader.cancel();
        throw new Error("Webhook too large");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function handleDirectorWebhook(request: Request, env: Env,
  persist: (receipts: DirectorReceipt[]) => Promise<void>) {
  const config = directorWebhookConfig(env);
  const headers = { "Cache-Control": "no-store" };
  if (!config.ready) return Response.json({ error: "Webhook disabled" }, { status: 503, headers });
  if (request.method === "GET") {
    const challenge = verifyMetaChallenge(new URL(request.url), config);
    return new Response(challenge ?? "Unauthorized", { status: challenge === null ? 401 : 200, headers });
  }
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  let bytes: Uint8Array;
  try { bytes = await readWebhookBytes(request); }
  catch { return Response.json({ error: "Invalid or oversized body" }, { status: 413, headers }); }
  if (!verifyMetaSignature(bytes, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  let receipts: DirectorReceipt[];
  try { receipts = parseDirectorReceipts(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), config); }
  catch { return Response.json({ error: "Invalid receipt payload" }, { status: 400, headers }); }
  // Acknowledge only after durable storage. Retried callbacks are idempotent.
  try { if (receipts.length) await persist(receipts); }
  catch { return Response.json({ error: "Receipt storage unavailable" }, { status: 503, headers }); }
  return Response.json({ received: true }, { headers });
}
