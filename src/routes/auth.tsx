import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
  const [busy, setBusy] = useState(false);
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
      if (next && /^\\/approvals(?:\\?|$)/.test(next)) {
        window.location.replace(next);
        return;
      }
      navigate({ to: "/dashboard", replace: true });
    };
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) afterSignIn();
    });
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      if (s && e !== "PASSWORD_RECOVERY") afterSignIn();
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
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
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <img src={brandLogo.url} alt="KK GROUP" className="mb-8 h-24 w-auto max-w-full object-contain object-left lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight">{mode === "in" ? "Sign in" : "Reset password"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "in" ? "Procurement & Project Management ERP" : "We'll email you a link to set a new password."}
          </p>
          {sent ? (
            <div className="mt-6 rounded-md border bg-card p-4 text-sm">If <b>{email}</b> is a staff account, a reset link is on its way.</div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {mode === "in" && (
                <div className="space-y-1.5">
                  <Label htmlFor="pw">Password</Label>
                  <Input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              )}
              <Button type="submit" className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Send reset link"}</Button>
            </form>
          )}
          <button className="mt-6 text-sm text-primary underline-offset-4 hover:underline" onClick={() => { setMode(mode === "in" ? "forgot" : "in"); setSent(false); }}>
            {mode === "in" ? "Forgot password?" : "Back to sign in"}
          </button>
          <p className="mt-8 text-xs text-muted-foreground">Accounts are created by your administrator.</p>
        </div>
      </div>
    </div>
  );
}
