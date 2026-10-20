import { sendLovableEmail } from "@lovable.dev/email-js";
import { render } from "@react-email/render";
import { createElement } from "react";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { EmailChangeEmail } from "@/lib/email-templates/email-change";
import type { PendingEmailChange } from "@/lib/email-otp";

export { makeEmailCode, hashEmailCode } from "./email-otp-crypto";

export function emailSecret() {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Email verification is not configured. Contact your administrator.");
  return key;
}

// These service-only RPCs are intentionally absent from the browser's generated API.
const db = supabaseAdmin as unknown as {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};
export async function emailRpc<T>(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function sendEmailCodes(
  pending: PendingEmailChange,
  oldCode: string,
  newCode: string,
) {
  const recipients = [
    { side: "new", email: pending.newEmail, code: newCode },
    ...(pending.oldEmail ? [{ side: "old", email: pending.oldEmail, code: oldCode }] : []),
  ];
  // Separate messages ensure one inbox never receives the other inbox's code.
  const results = await Promise.allSettled(
    recipients.map(async (recipient) => {
      const element = createElement(EmailChangeEmail, {
        siteName: "KK GROUP",
        oldEmail: pending.oldEmail ?? "",
        email: recipient.email,
        newEmail: pending.newEmail,
        token: recipient.code,
        firstEmail: !pending.oldEmail,
      });
      const result = await sendLovableEmail(
        {
          to: recipient.email,
          from: { name: "KK GROUP ERP", address: "noreply@notify.kkgrouppurchase.in" },
          sender_domain: "notify.kkgrouppurchase.in",
          subject: "Your email verification code · KK GROUP ERP",
          html: await render(element),
          text: await render(element, { plainText: true }),
          purpose: "transactional",
          idempotency_key: `profile-email-${pending.id}-${recipient.side}`,
        },
        { apiKey: emailSecret(), sendUrl: process.env["LOVABLE_SEND_URL"] },
      );
      if (!result.success) throw new Error("Email was not accepted for delivery");
    }),
  );
  if (results.some((result) => result.status === "rejected")) {
    // Never return provider payloads, codes, tokens, or email API credentials.
    throw new Error(
      "One or more verification emails could not be sent. Please request new codes after 60 seconds. Your email has not changed.",
    );
  }
}

/** Recheck the live Auth user for sensitive changes, including MFA and account bans. */
export async function verifyEmailActor(
  client: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
) {
  const { getRequest } = await import("@tanstack/react-start/server");
  const token = getRequest()
    .headers.get("authorization")
    ?.replace(/^Bearer /, "");
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user || data.user.id !== userId)
    throw new Error("Please sign in again before changing your email.");
  if (data.user.factors?.some((factor) => factor.status === "verified")) {
    const { data: claims, error: claimsError } = await client.auth.getClaims(token);
    if (claimsError || claims?.claims.aal !== "aal2")
      throw new Error("Complete your two-step sign-in before changing your email.");
  }
  return data.user;
}
