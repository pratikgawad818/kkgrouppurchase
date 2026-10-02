import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import brandMark from "@/assets/kk-groups-mark-clean.png.asset.json";
import brandLogo from "@/assets/kk-groups-logo-clean.png.asset.json";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — KK Group ERP" },
      { name: "description", content: "Sign in to the KK Group ERP workspace." },
      { property: "og:title", content: "Sign in — KK Group ERP" },
      { property: "og:description", content: "Sign in to the KK Group ERP workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) navigate({ to: "/dashboard", replace: true });
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
        const { data, error } = await supabase.auth.signUp({
          email, password, options: { emailRedirectTo: window.location.origin + "/dashboard", data: { full_name: name } },
        });
        if (error) throw error;
        if (!data.session) setSent(true);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error(r.error.message ?? "Google sign-in failed.");
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2.5">
           <div className="grid h-10 w-10 place-items-center rounded-sm bg-card p-0.5"><img src={brandMark.url} alt="KK Group" className="h-full w-full object-contain" /></div>
           <span className="font-semibold text-sidebar-accent-foreground">KK GROUP ERP</span>
        </div>
        <blockquote className="max-w-md text-2xl font-medium leading-snug text-sidebar-accent-foreground">
          “Every material and every rupee — traceable from requirement to final use.”
        </blockquote>
        <div className="font-mono text-xs text-sidebar-foreground/60">KK Infra Developers Pvt Ltd · Pune</div>
      </div>
      <div className="flex items-center justify-center p-6">
         <div className="w-full max-w-sm">
            <img src={brandLogo.url} alt="KK Group" className="mb-8 h-24 w-auto max-w-full object-contain object-left lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight">{mode === "in" ? "Sign in" : "Create staff account"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "in" ? "Use your company credentials." : "An administrator will assign your role after sign-up."}
          </p>
          {sent ? (
            <div className="mt-6 rounded-md border bg-card p-4 text-sm">
              Check <b>{email}</b> for a confirmation link, then sign in.
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              {mode === "up" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw">Password</Label>
                <Input id="pw" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}</Button>
              <div className="relative py-1 text-center text-xs text-muted-foreground"><span className="bg-background px-2">or</span></div>
              <Button type="button" variant="outline" className="w-full" onClick={google}>Continue with Google</Button>
            </form>
          )}
          <button className="mt-6 text-sm text-primary underline-offset-4 hover:underline" onClick={() => { setMode(mode === "in" ? "up" : "in"); setSent(false); }}>
            {mode === "in" ? "New staff member? Create an account" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
