import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getMyEmailOtp, requestMyEmailOtp, verifyMyEmailOtp } from "@/lib/email-otp.functions";
import {
  cleanEmailCode,
  maskEmail,
  type EmailProofSide,
  type PendingEmailChange,
} from "@/lib/email-otp";

export function EmailVerification({ currentEmail }: { currentEmail: string }) {
  const requestOtp = useServerFn(requestMyEmailOtp),
    verifyOtp = useServerFn(verifyMyEmailOtp),
    readOtp = useServerFn(getMyEmailOtp);
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["my-email-otp"], queryFn: () => readOtp(), retry: false });
  const [pending, setPending] = useState<PendingEmailChange | null>(null);
  const [email, setEmail] = useState("");
  const [codes, setCodes] = useState({ old: "", new: "" });
  const [errors, setErrors] = useState({ old: "", new: "", request: "" });
  const [busy, setBusy] = useState<EmailProofSide | "send" | null>(null);
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (status.data) {
      setPending(status.data);
      setEmail(status.data.newEmail);
    }
  }, [status.data]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired = !!pending && Date.parse(pending.expiresAt) <= now;
  const wait = pending ? Math.max(0, Math.ceil((Date.parse(pending.resendAt) - now) / 1000)) : 0;

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy("send");
    setErrors({ old: "", new: "", request: "" });
    try {
      const next = await requestOtp({ data: { email } });
      setPending(next);
      setCodes({ old: "", new: "" });
      setEditing(false);
      qc.setQueryData(["my-email-otp"], next);
      toast.success(
        next.oldEmail
          ? "Codes sent to your current and new email."
          : "Code sent to your new email.",
      );
    } catch (error) {
      setErrors((previous) => ({ ...previous, request: (error as Error).message }));
      await status.refetch();
    } finally {
      setBusy(null);
    }
  }
  async function verify(side: EmailProofSide) {
    if (!pending) return;
    setBusy(side);
    setErrors((previous) => ({ ...previous, [side]: "" }));
    try {
      const result = await verifyOtp({ data: { id: pending.id, side, code: codes[side] } });
      if (result.complete) {
        setPending(null);
        setEmail("");
        setCodes({ old: "", new: "" });
        setEditing(false);
        qc.setQueryData(["my-email-otp"], null);
        // The existing session remains valid; refresh its email claim after the atomic update.
        await supabase.auth.refreshSession();
        await qc.invalidateQueries({ queryKey: ["me"] });
        toast.success("Email verified and updated. You can now use it to sign in.");
      } else {
        const next = {
          ...pending,
          oldVerified: result.oldVerified,
          newVerified: result.newVerified,
        };
        setPending(next);
        qc.setQueryData(["my-email-otp"], next);
        toast.success("Inbox verified. Verify the other inbox to finish.");
      }
    } catch (error) {
      setErrors((previous) => ({ ...previous, [side]: (error as Error).message }));
    } finally {
      setBusy(null);
    }
  }
  function proof(side: EmailProofSide, address: string) {
    const verified = side === "old" ? pending?.oldVerified : pending?.newVerified;
    const label = side === "old" ? "Current email" : currentEmail ? "New email" : "Your email";
    return (
      <div className="min-w-0 rounded-xl border bg-background p-4" key={side}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{label}</div>
            <div className="mt-1 break-all text-xs text-muted-foreground">{maskEmail(address)}</div>
          </div>
          {verified && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
              <Check className="h-3 w-3" />
              Verified
            </span>
          )}
        </div>
        {!verified && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verify(side);
            }}
            className="space-y-3"
          >
            <Label htmlFor={`email-${side}-otp`} className="sr-only">
              {label} six-digit code
            </Label>
            <Input
              id={`email-${side}-otp`}
              value={codes[side]}
              onChange={(e) =>
                setCodes((previous) => ({ ...previous, [side]: cleanEmailCode(e.target.value) }))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              placeholder="000000"
              disabled={!!busy || expired}
              aria-invalid={!!errors[side]}
              aria-describedby={errors[side] ? `email-${side}-error` : undefined}
              className="h-12 text-center font-mono text-xl tracking-[0.3em]"
            />
            {errors[side] && (
              <p id={`email-${side}-error`} role="alert" className="text-xs text-destructive">
                {errors[side]}
              </p>
            )}
            <Button
              type="submit"
              variant="outline"
              className="h-11 w-full"
              disabled={!!busy || expired || codes[side].length !== 6}
            >
              {busy === side ? "Verifying…" : "Verify code"}
            </Button>
          </form>
        )}
      </div>
    );
  }
  return (
    <section
      className="rounded-xl border bg-card p-5 shadow-card"
      aria-labelledby="email-security-title"
    >
      <div className="mb-4 flex items-start gap-3">
        <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h2 id="email-security-title" className="font-semibold">
            Sign-in email
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {currentEmail
              ? "Verify both inboxes before your sign-in email changes."
              : "Add an email for sign-in and password recovery. Verify it with a one-time code."}
          </p>
        </div>
      </div>
      {currentEmail && (
        <div className="mb-4 flex min-w-0 items-center gap-2 rounded-lg bg-muted/50 p-3 text-sm">
          <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="break-all">{currentEmail}</span>
        </div>
      )}
      {(!pending || editing) && (
        <form onSubmit={send} className="space-y-3">
          <Label htmlFor="new-sign-in-email">
            {currentEmail ? "New email address" : "Email address"}
          </Label>
          <Input
            id="new-sign-in-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={255}
            placeholder="you@example.com"
            className="h-11"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              className="h-11"
              disabled={
                !!busy ||
                wait > 0 ||
                !email.trim() ||
                email.trim().toLowerCase() === currentEmail.toLowerCase()
              }
            >
              {busy === "send"
                ? "Sending…"
                : wait > 0
                  ? `Send again in ${wait}s`
                  : currentEmail
                    ? "Send verification codes"
                    : "Send verification code"}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                onClick={() => setEditing(false)}
              >
                Back to verification
              </Button>
            )}
          </div>
        </form>
      )}
      {pending && !editing && (
        <div className="space-y-4">
          <p role="status" className="text-sm leading-6">
            {expired
              ? "These codes have expired. Request new codes below."
              : pending.oldEmail
                ? "Enter the separate codes from your current and new inboxes. Either inbox can be verified first."
                : "Enter the six-digit code sent to your email."}
            <span className="mt-1 block break-all text-xs text-muted-foreground">
              Requested email: {pending.newEmail}
            </span>
          </p>
          <div className={`grid gap-3 ${pending.oldEmail ? "sm:grid-cols-2" : ""}`}>
            {pending.oldEmail && proof("old", pending.oldEmail)}
            {proof("new", pending.newEmail)}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-2"
              disabled={!!busy || wait > 0}
              onClick={() => void send()}
            >
              {busy === "send" ? "Sending…" : wait > 0 ? `Resend in ${wait}s` : "Resend codes"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-2"
              disabled={!!busy}
              onClick={() => setEditing(true)}
            >
              Use another email
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Codes expire in 10 minutes. Resending replaces both codes and resets verification. Your
            current sign-in stays active until verification is complete.
          </p>
        </div>
      )}
      {errors.request && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {errors.request}
        </p>
      )}
      {status.isError && !pending && (
        <p className="mt-3 text-xs text-muted-foreground">
          Pending verification could not be loaded. You can request a fresh code above.
        </p>
      )}
    </section>
  );
}
