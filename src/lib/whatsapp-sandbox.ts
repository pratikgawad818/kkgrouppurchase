/** Pinned Meta developer TEST sender. Production sending is NOT supported here. */
export const SANDBOX = {
  phoneNumberId: "1463820473473034",
  wabaId: "2335711970592462",
  displayNumber: "+1 (555) 657-8423",
} as const;
type Env = Readonly<Record<string, string | undefined>>;
export type TestConfig = {
  enabled: boolean; ready: boolean; missing: string[];
  recipient: string | null; maskedRecipient: string | null; token: string | null;
};
export function parseTestRecipient(value: string | undefined): string | null {
  const number = value?.trim() ?? "";
  // Never guess a country code or accept the local business number from the UI.
  return /^\+[1-9][0-9]{7,14}$/.test(number) ? number.slice(1) : null;
}
export function getTestConfig(env: Env): TestConfig {
  const enabled = env["KK_WHATSAPP_TEST_ENABLED"] === "true";
  const recipient = parseTestRecipient(env["KK_WHATSAPP_TEST_RECIPIENT"]);
  const token = env["KK_WHATSAPP_TEST_ACCESS_TOKEN"]?.trim() || null;
  const missing: string[] = [];
  if (!enabled) missing.push("KK_WHATSAPP_TEST_ENABLED=true");
  if (!recipient) missing.push("KK_WHATSAPP_TEST_RECIPIENT (+country code)");
  if (!token) missing.push("KK_WHATSAPP_TEST_ACCESS_TOKEN");
  if (env["KK_WHATSAPP_TEST_PHONE_NUMBER_ID"] !== SANDBOX.phoneNumberId) missing.push("KK_WHATSAPP_TEST_PHONE_NUMBER_ID (must be pinned test ID)");
  if (env["KK_WHATSAPP_TEST_WABA_ID"] !== SANDBOX.wabaId) missing.push("KK_WHATSAPP_TEST_WABA_ID (must be pinned test WABA)");
  return { enabled, ready: missing.length === 0, missing, recipient, token,
    maskedRecipient: recipient ? "+" + recipient.slice(0, -4).replace(/./g, "•") + recipient.slice(-4) : null };
}
/**
 * Accepts no message content, sender or recipient from the browser.
 * Does not retry requests because Meta may have accepted an interrupted send.
 * Returned wamid is acceptance, NOT delivery.
 */
export async function sendHelloWorld(config: TestConfig, fetcher: typeof fetch = fetch): Promise<string> {
  if (!config.ready || !config.recipient || !config.token) throw new Error("WhatsApp test environment is disabled or incomplete.");
  let response: Response;
  try {
    response = await fetcher("https://graph.facebook.com/v25.0/" + SANDBOX.phoneNumberId + "/messages", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: "Bearer " + config.token, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: config.recipient, type: "template",
        template: { name: "hello_world", language: { code: "en_US" } } }),
    });
  } catch {
    throw new Error("Meta connection failed; check status and recipient delivery before retrying.");
  }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error("Meta rejected sandbox credentials. Renew the temporary test token.");
    if (response.status === 400) throw new Error("Meta rejected the sandbox request. Check that the recipient was verified in Meta.");
    throw new Error("Meta rejected the sandbox request (HTTP " + response.status + ").");
  }
  let data: { messages?: { id?: unknown }[] };
  try { data = await response.json() as { messages?: { id?: unknown }[] }; }
  catch { throw new Error("Meta response unreadable; check device before retrying."); }
  const messageId = data.messages?.[0]?.id;
  if (typeof messageId !== "string" || !messageId.startsWith("wamid.")) {
    throw new Error("Meta returned no valid message ID; check device before retrying.");
  }
  return messageId;
}
