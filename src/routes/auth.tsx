import { signInWithUsername } from "@/lib/admin.functions";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import brandLogo from "@/assets/kk-groups-full.png.asset.json";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — KK GROUP ERP" },
      { name: "description", content: "Staff sign-in for KK GROUP Procurement & Project Management ERP." },
      { property: "og:title", content: "Sign in — KK GROUP ERP" },
      { property: "og:description", content: "Staff sign-in for KK GROUP Procurement & Project Management ERP." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "forgot">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    // Invite / recovery links arrive with tokens in the URL hash — send them
    // to the password page before any session-based redirect swallows them.
    const hash = window.location.hash;
    if (hash.includes("access_token") || hash.includes("type=invite") || hash.includes("type=recovery")) {
      window.location.replace("/reset-password" + hash);
      return;
    }
    let navigating = false;
    const afterSignIn = () => {
      if (navigating) return;
      navigating = true;
      const next = window.sessionStorage.getItem("kk-approval-return");
      window.sessionStorage.removeItem("kk-approval-return");
      if (next && /^\/approvals(?:\?|$)/.test(next)) {
        window.location.replace(next);
        return;
      }
      navigate({ to: "/dashboard", replace: true });
    };
    supabase.auth.getSession()
      .then(({ data }) => {
        if (data.session) afterSignIn();
        else setCheckingSession(false);
      })
      .catch(() => setCheckingSession(false));
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      if (s && e !== "PASSWORD_RECOVERY") afterSignIn();
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "in") {
        if (email.includes("@")) {
          const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
          if (error) throw error;
        } else {
          const tokens = await signInWithUsername({ data: { username: email, password } });
          const { error } = await supabase.auth.setSession(tokens);
          if (error) throw error;
        }
      } else {
        if (!email.includes("@")) throw new Error("Enter the email address saved in your profile. If you only have a username, sign in and add your email in My profile first.");
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/reset-password" });
        if (error) throw error;
        setSent(true);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-20 place-items-center rounded-sm bg-card p-1"><img src={brandLogo.url} alt="KK GROUP" className="h-full w-full object-contain" /></div>
          <div className="leading-tight">
            <div className="font-semibold text-sidebar-accent-foreground">KK GROUP ERP</div>
            <div className="text-xs text-sidebar-foreground/60">Procurement & Project Management</div>
          </div>
        </div>
        <blockquote className="max-w-md text-2xl font-medium leading-snug text-sidebar-accent-foreground">
          Every material and every rupee — traceable from requirement to payment.
        </blockquote>
        <div className="text-xs text-sidebar-foreground/60">Internal system · Authorised staff only</div>
      </div>
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-primary/10 via-background to-background p-5 sm:p-8 lg:min-h-0 lg:bg-none">
        <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-lg sm:p-8">
          <div className="mb-6 flex justify-center lg:hidden">
            <img src={brandLogo.url} alt="KK GROUP" className="h-20 w-auto max-w-full object-contain" />
          </div>
          <div className="mb-1 h-1 w-10 rounded-full bg-primary" />
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{mode === "in" ? "Welcome back" : "Reset password"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "in" ? "Sign in to KK GROUP Procurement & Project Management" : "We'll email you a link to set a new password."}
          </p>
          {checkingSession ? (
            <div role="status" aria-live="polite" className="mt-6 flex items-center gap-3 rounded-md border bg-card p-4 text-sm text-muted-foreground">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary motion-reduce:animate-none" />
              Checking your session…
            </div>
          ) : sent ? (
            <div className="mt-6 rounded-md border bg-card p-4 text-sm">If <b>{email}</b> is a staff account, a reset link is on its way.</div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">{mode === "in" ? "Username or email" : "Email"}</Label>
                <Input id="email" type={mode === "in" ? "text" : "email"} autoCapitalize="none" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {mode === "in" && (
                <div className="space-y-1.5">
                  <Label htmlFor="pw">Password</Label>
                  <div className="relative">
                    <Input id="pw" type={showPw ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="pr-11" />
                    <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={showPw} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}
              <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Send reset link"}</Button>
            </form>
          )}
          <div className="mt-5 text-center">
            <button disabled={checkingSession || busy} className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50" onClick={() => { setMode(mode === "in" ? "forgot" : "in"); setSent(false); }}>
              {mode === "in" ? "Forgot password?" : "Back to sign in"}
            </button>
          </div>
          <p className="mt-4 border-t pt-4 text-center text-xs text-muted-foreground">Accounts are created by your administrator.</p>
        </div>
        <p className="mt-6 text-xs text-muted-foreground lg:hidden">Internal system · Authorised staff only</p>
      </div>
    </div>
  );
}
