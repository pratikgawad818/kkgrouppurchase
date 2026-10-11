/** SERVER-ONLY director approval template sender. All send gates fail closed. */
import { approvalReference } from "./director-whatsapp-reference";

export type DirectorNotice = {
  outbox_id: string;
  lease_id: string;
  phone: string;
  kind: "purchase_order" | "vendor_payment";
  number: string;
  document_id: string;
  notice_stage: "initial" | "reminder_1" | "reminder_2";
};
type Env = Readonly<Record<string, string | undefined>>;

export function directorWaConfig(env: Env) {
  const id = env.KK_DIRECTOR_WA_CLOUD_PHONE_ID ?? "";
  const waba = env.KK_DIRECTOR_WA_WABA_ID ?? "";
  const token = env.KK_DIRECTOR_WA_ACCESS_TOKEN ?? "";
  const origin = env.KK_DIRECTOR_WA_APPROVAL_ORIGIN ?? "";
  const template = env.KK_DIRECTOR_WA_TEMPLATE_NAME ?? "";
  let validOrigin = false;
  try { const url = new URL(origin); validOrigin = url.protocol === "https:" && !!url.hostname && url.username === "" && url.password === "" && url.pathname === "/" && !url.search && !url.hash; }
  catch { validOrigin = false; }
  // App coexistence MUST be explicitly verified in Meta before any send.
  // The exact sender and WABA IDs must be independently allowlisted.
  const ready = env.KK_DIRECTOR_WA_SEND_ENABLED === "true" &&
    env.KK_DIRECTOR_WA_COEXISTENCE_VERIFIED === "true" &&
    /^\d{8,30}$/.test(id) && /^\d{8,30}$/.test(waba) &&
    id === env.KK_DIRECTOR_WA_APPROVED_PHONE_ID &&
    waba === env.KK_DIRECTOR_WA_APPROVED_WABA_ID &&
    token.length >= 20 && validOrigin &&
    /^[a-z][a-z0-9_]{2,127}$/.test(template) &&
    env.KK_DIRECTOR_WA_TEMPLATE_APPROVED === "true";
  return { ready, id, waba, token, origin, template };
}

export function templatePayload(config: ReturnType<typeof directorWaConfig>, notice: DirectorNotice) {
  if (!config.ready) throw new Error("Director WhatsApp delivery is disabled or unverified.");
  if (!/^[1-9][0-9]{7,14}$/.test(notice.phone)) throw new Error("Invalid director recipient.");
  if (!/^[0-9a-f-]{36}$/i.test(notice.document_id) ||
    !/^[a-zA-Z0-9_./-]{1,110}$/.test(notice.number)) throw new Error("Invalid approval reference.");
  const label = notice.kind === "purchase_order" ? "Purchase Order" : "Vendor Payment";
  const kind = notice.kind === "purchase_order" ? "Purchase Order" : "Vendor Payment";
  // The approved Meta utility template must contain:
  // Body {{1}} = request type; {{2}} = document number.
  // URL button 0 = https://<APPROVAL_ORIGIN>/approvals?ref={{1}}
  return {
    messaging_product: "whatsapp" as const,
    recipient_type: "individual" as const,
    to: notice.phone,
    type: "template" as const,
    template: {
      name: config.template, language: { code: "en" },
      components: [
        { type: "body", parameters: [
          { type: "text", text: notice.notice_stage === "initial" ? label : "Reminder: " + kind },
          { type: "text", text: notice.number },
        ]},
        { type: "button", sub_type: "url", index: "0", parameters: [
          { type: "text", text: approvalReference(notice.kind, notice.document_id) },
        ]},
      ],
    },
  };
}

export type MetaResult = { status: "accepted" | "rejected" | "unknown"; messageId: string | null; errorCode: string };
export async function deliverDirectorTemplate(
  config: ReturnType<typeof directorWaConfig>, notice: DirectorNotice,
  fetcher: typeof fetch = fetch,
): Promise<MetaResult> {
  // Construct + validate locally before any network call.
  const payload = templatePayload(config, notice);
  try {
    const response = await fetcher("https://graph.facebook.com/v25.0/" + config.id + "/messages", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: "Bearer " + config.token, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // A 4xx response other than 408/409/429 is a definite API rejection.
    // Network timeout, unknown response, 429 and 5xx may have been accepted:
    // do NOT resend automatically, as that risks duplicate director alerts.
    if (!response.ok) return { status: [408,409,429].includes(response.status) || response.status >= 500 ? "unknown" : "rejected",
      messageId: null, errorCode: "meta_http_" + response.status };
    let json: unknown;
    try { json = await response.json(); }
    catch { return { status: "unknown", messageId: null, errorCode: "meta_unreadable" }; }
    const received = (json as { messages?: Array<{ id?: unknown }> })?.messages?.[0]?.id;
    if (typeof received !== "string" || !/^wamid\.[\w.-]{1,290}$/.test(received)) {
      return { status: "unknown", messageId: null, errorCode: "meta_missing_wamid" };
    }
    return { status: "accepted", messageId: received, errorCode: "" };
  } catch {
    return { status: "unknown", messageId: null, errorCode: "meta_connection_uncertain" };
  }
}
