import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set password — KK GROUP ERP" },
      { name: "description", content: "Set a new password for your KK GROUP ERP account." },
      { property: "og:title", content: "Set password — KK GROUP ERP" },
      { property: "og:description", content: "Set a new password for your KK GROUP ERP account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<"checking" | "ok" | "invalid">("checking");

  useEffect(() => {
    // The invite/recovery link carries tokens in the URL hash; the Supabase
    // client exchanges them for a session. Wait for that before showing the form.
    let settled = false;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY" || event === "INITIAL_SESSION")) {
        settled = true;
        setReady("ok");
      }
    });
    supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) { settled = true; setReady("ok"); }
    });
    const timer = setTimeout(() => { if (!settled) setReady("invalid"); }, 4000);
    return () => { data.subscription.unsubscribe(); clearTimeout(timer); };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      {ready === "checking" ? (
        <p className="text-sm text-muted-foreground">Verifying your link…</p>
      ) : ready === "invalid" ? (
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Link expired or invalid</h1>
          <p className="text-sm text-muted-foreground">
            This password link has already been used or has expired. Ask your administrator to send a new invite, or use “Forgot password” on the sign-in page.
          </p>
          <Link to="/auth" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Go to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
          <div className="space-y-1.5">
            <Label htmlFor="pw">New password</Label>
            <Input id="pw" type="password" minLength={8} required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save password"}</Button>
        </form>
      )}
    </div>
  );
}
