import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, MessageCircle, Send, ShieldCheck, TestTube2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loading, PageHeader } from "@/components/erp/common";
import { useMe } from "@/lib/session";
import { getWhatsAppTestStatus, sendWhatsAppTest } from "@/lib/whatsapp-test.functions";

export const Route = createFileRoute("/_authenticated/_shell/settings/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp Sandbox — KK GROUP ERP" },
    { name: "description", content: "Restricted Meta WhatsApp test-number integration." }] }),
  component: WhatsAppSandbox,
});

function WhatsAppSandbox() {
  const me = useMe();
  const statusFn = useServerFn(getWhatsAppTestStatus);
  const sendFn = useServerFn(sendWhatsAppTest);
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const permitted = !!me.data?.profile.is_active && !!me.data?.profile.company_id &&
    !!me.data?.roles.includes("super_admin") && me.data.permissions.has("users.manage");
  const status = useQuery({ queryKey: ["whatsapp-sandbox-status"], queryFn: () => statusFn(),
    enabled: permitted, retry: false, staleTime: 30_000 });
  const send = useMutation({ mutationFn: () => sendFn({ data: { confirm: true } }),
    onSuccess: (result) => { setReceipt(result.messageId); setConfirmed(false); } });

  if (me.isLoading) return <Loading />;
  if (!permitted) return <p role="alert" className="rounded-xl border p-5 text-sm text-destructive">WhatsApp testing requires an active ERP super administrator.</p>;

  return <div className="pb-12">
    <PageHeader title="WhatsApp API · Sandbox" subtitle="Meta test-number integration, isolated from the main KK GROUP portfolio and live purchase phone." />
    <div className="mb-5 flex flex-wrap gap-2 text-xs">
      <span className="rounded-full border bg-muted/40 px-3 py-2 font-medium"><TestTube2 className="mr-1 inline h-4 w-4" /> Test account only</span>
      <span className="rounded-full border px-3 py-2">Real WhatsApp number untouched</span>
      <span className="rounded-full border px-3 py-2">Supplier messaging disabled</span>
    </div>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="rounded-xl border bg-card p-5 shadow-card">
        <h2 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="h-5 w-5 text-primary" />Sandbox connection</h2>
        <p className="mt-2 text-sm text-muted-foreground">Credentials stay in the private server environment. Never paste a Meta token into this page, GitHub, or Lovable.</p>
        {status.isLoading ? <div className="mt-4"><Loading /></div> : status.error ?
          <p role="alert" className="mt-4 text-sm text-destructive">{status.error.message}</p> :
          status.data && <div className="mt-5 space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              {status.data.ready ? <CheckCircle2 className="h-4 w-4 text-green-700" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
              {status.data.ready ? "Test credentials configured" : "Private server configuration required"}
            </p>
            <dl className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Sandbox sender</dt><dd className="font-medium">{status.data.sender}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Verified recipient</dt><dd className="font-medium">{status.data.recipient || "Not set"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Message template</dt><dd className="font-medium">hello_world (en_US)</dd></div>
              <div><dt className="text-xs text-muted-foreground">Sending mode</dt><dd className="font-medium">Manual test only</dd></div>
            </dl>
            {!status.data.ready && <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">Missing server settings</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-muted-foreground">{status.data.missing.map(v => <li key={v}><code>{v}</code></li>)}</ul>
            </div>}
          </div>}
        <div className="mt-6 border-t pt-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><MessageCircle className="h-4 w-4" />Send fixed hello_world message</h3>
          <p className="mt-2 text-sm text-muted-foreground">Only sends Meta's test template to the single server-approved recipient. No custom text, supplier details, attachments, or mass messaging.</p>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input className="mt-1 h-4 w-4" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
            I authorize one sandbox test message to the verified recipient.
          </label>
          <Button className="mt-4" disabled={!status.data?.ready || !confirmed || send.isPending}
            onClick={() => { setReceipt(null); send.mutate(); }}>
            <Send className="h-4 w-4" /> {send.isPending ? "Requesting…" : "Send hello_world test"}
          </Button>
          {send.error && <p role="alert" className="mt-3 text-sm text-destructive">{send.error.message}</p>}
          {receipt && <div role="status" className="mt-3 rounded-lg border p-3 text-sm">
            <p className="font-semibold">Meta accepted the request. Confirm delivery on the recipient's phone.</p>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{receipt}</p>
            <p className="mt-2 text-xs text-muted-foreground">This receipt is not durable message history.</p>
          </div>}
        </div>
      </section>
      <aside className="space-y-4">
        <div className="rounded-xl border bg-card p-5 shadow-card">
          <h2 className="text-sm font-semibold">Integration roadmap</h2>
          <ol className="mt-3 space-y-3 text-sm">
            <li><strong>1. API sandbox</strong><p className="text-xs text-muted-foreground">Fixed, authorized test messages.</p></li>
            <li><strong>2. Supplier workflow</strong><p className="text-xs text-muted-foreground">Verified contacts, consent, approved templates, durable outbox, audit and delivery receipts.</p></li>
            <li><strong>3. Real number</strong><p className="text-xs text-muted-foreground">Check WhatsApp Business App + Cloud API coexistence before any onboarding.</p></li>
          </ol>
        </div>
        <div className="rounded-xl border p-5 text-sm">
          <h2 className="font-semibold">Safety boundaries</h2>
          <p className="mt-2 text-muted-foreground">No supplier sends, no live Meta account changes, no database migration, no automatic retry and no credential storage in the browser.</p>
          <a href="https://developers.facebook.com/apps/1103623782629172/" target="_blank" rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 font-medium text-primary hover:underline">
            Open Meta developer app <ExternalLink className="h-4 w-4" /></a>
        </div>
      </aside>
    </div>
  </div>;
}
