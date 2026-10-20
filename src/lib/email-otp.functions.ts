import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isSyntheticEmail } from "@/lib/staff-login";
import type { PendingEmailChange } from "@/lib/email-otp";

export const requestMyEmailOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ email: z.string().trim().toLowerCase().email().max(255) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (isSyntheticEmail(data.email)) throw new Error("Please enter a real email address.");
    const {
      emailSecret,
      makeEmailCode,
      hashEmailCode,
      emailRpc,
      sendEmailCodes,
      verifyEmailActor,
    } = await import("@/lib/email-otp.server");
    const secret = emailSecret();
    const user = await verifyEmailActor(context.supabase, context.userId);
    if (!user.email) throw new Error("Your account could not be verified.");
    const id = crypto.randomUUID();
    const oldCode = makeEmailCode(),
      newCode = makeEmailCode();
    const pending = await emailRpc<PendingEmailChange>("begin_profile_email_otp", {
      _user_id: context.userId,
      _id: id,
      _email: data.email,
      _old_hash: await hashEmailCode(secret, context.userId, id, "old", user.email, oldCode),
      _new_hash: await hashEmailCode(secret, context.userId, id, "new", data.email, newCode),
    });
    await sendEmailCodes(pending, oldCode, newCode);
    return pending;
  });

export const verifyMyEmailOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        side: z.enum(["old", "new"]),
        code: z.string().regex(/^\d{6}$/, "Enter the six-digit code."),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { emailSecret, hashEmailCode, emailRpc, verifyEmailActor } =
      await import("@/lib/email-otp.server");
    await verifyEmailActor(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("profile_email_challenges" as never)
      .select("old_email,new_email")
      .eq("user_id", context.userId)
      .eq("id", data.id)
      .maybeSingle();
    const challenge = row as { old_email: string; new_email: string } | null;
    if (error || !challenge) throw new Error("Codes expired or unavailable. Request new codes.");
    const hash = await hashEmailCode(
      emailSecret(),
      context.userId,
      data.id,
      data.side,
      data.side === "old" ? challenge.old_email : challenge.new_email,
      data.code,
    );
    // A wrong-code result is returned, not raised in SQL: failed attempts must commit.
    const result = await emailRpc<{
      ok: boolean;
      complete?: boolean;
      oldVerified?: boolean;
      newVerified?: boolean;
      error?: string;
    }>("verify_profile_email_otp", {
      _user_id: context.userId,
      _id: data.id,
      _side: data.side,
      _hash: hash,
    });
    if (!result.ok) throw new Error(result.error ?? "Verification failed.");
    return {
      complete: !!result.complete,
      oldVerified: !!result.oldVerified,
      newVerified: !!result.newVerified,
    };
  });

export const getMyEmailOtp = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profile_email_challenges" as never)
      .select("id,old_email,new_email,old_verified,new_verified,expires_at,sent_at")
      .eq("user_id", context.userId)
      .is("completed_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw new Error("Email verification status could not be loaded.");
    if (!data) return null;
    const row = data as {
      id: string;
      old_email: string;
      new_email: string;
      old_verified: boolean;
      new_verified: boolean;
      expires_at: string;
      sent_at: string;
    };
    return {
      id: row.id,
      oldEmail: isSyntheticEmail(row.old_email) ? null : row.old_email,
      newEmail: row.new_email,
      oldVerified: row.old_verified,
      newVerified: row.new_verified,
      expiresAt: row.expires_at,
      resendAt: new Date(Date.parse(row.sent_at) + 60_000).toISOString(),
    } satisfies PendingEmailChange;
  });
