import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ensureDirectorPush, enablePush, disablePush, type PushStatus } from "@/lib/web-push";
import { testMyPhoneAlert } from "@/lib/push.functions";
import { supabase } from "@/integrations/supabase/client";
import { errMsg } from "@/lib/format";
import { Button } from "@/components/ui/button";

type Device = { id: string; endpoint: string; created_at: string };
const hints: Partial<Record<PushStatus, string>> = {
  "open-in-new-tab": "Open the ERP in its own browser tab to set up phone alerts.",
  "install-first":
    "On iPhone or iPad: Share → Add to Home Screen. Open that icon, then enable alerts here.",
  denied:
    "Notifications are blocked. Allow them in your phone’s browser/site settings, then return here.",
  unsupported: "Use a supported browser over HTTPS. Android: Chrome. iPhone: the Home Screen app.",
  unavailable: "Could not check alerts. Check your connection and try again.",
};

export function PhoneAlerts({ userId, isDirector }: { userId: string; isDirector: boolean }) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const testAlert = useServerFn(testMyPhoneAlert);

  useEffect(() => {
    let active = true;
    let checking = false;
    async function sync() {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const next = await ensureDirectorPush(isDirector);
        if (active) setStatus(next);
      } catch {
        if (active) setStatus("unavailable");
      } finally {
        checking = false;
      }
    }
    void sync();
    window.addEventListener("focus", sync);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      active = false;
      window.removeEventListener("focus", sync);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [userId, isDirector]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function setup(repair = false) {
    // Run from the tap, before any network request, for browser permission consent.
    const result = await enablePush(repair);
    setStatus(result);
    if (result === "on") toast.success("Phone alerts are on for this device");
  }
  async function listDevices() {
    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("id,endpoint,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const reg = await navigator.serviceWorker?.getRegistration("/push-alerts/");
    setEndpoint((await reg?.pushManager.getSubscription())?.endpoint ?? null);
    setDevices(data ?? []);
  }
  return (
    <section aria-label="Phone alerts" className="space-y-2 border-b bg-muted/30 px-4 py-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold">Phone alerts</span>
        <span
          role="status"
          className={status === "on" ? "font-medium text-primary" : "text-muted-foreground"}
        >
          {busy
            ? "Working…"
            : status === null
              ? "Checking…"
              : status === "on"
                ? "On · this device"
                : status === "off"
                  ? "Off · this device"
                  : "Needs setup"}
        </span>
      </div>
      {status && hints[status] && <p className="text-xs text-muted-foreground">{hints[status]}</p>}
      <div className="flex flex-wrap gap-2">
        {status === "on" ? (
          <>
            <Button
              size="sm"
              disabled={busy}
              className="min-h-11"
              onClick={() =>
                void run(async () => {
                  const reg = await navigator.serviceWorker.getRegistration("/push-alerts/");
                  const sub = await reg?.pushManager.getSubscription();
                  if (!sub) {
                    setStatus("off");
                    throw new Error("Enable alerts on this phone first.");
                  }
                  await testAlert({ data: { endpoint: sub.endpoint } });
                  toast.success("Test sent. Check your phone’s notification tray.");
                })
              }
            >
              Send test
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              className="min-h-11"
              onClick={() => void run(() => setup(true))}
            >
              Repair alerts
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              className="min-h-11"
              onClick={() =>
                void run(async () => {
                  await disablePush();
                  setStatus("off");
                })
              }
            >
              Turn off
            </Button>
          </>
        ) : (
          (status === "off" || status === "unavailable") && (
            <Button
              size="sm"
              className="min-h-11"
              disabled={busy}
              onClick={() => void run(() => setup())}
            >
              Turn on phone alerts
            </Button>
          )
        )}
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11"
          disabled={busy}
          onClick={() => void run(listDevices)}
        >
          Manage devices
        </Button>
      </div>
      {status === "on" && (
        <p className="text-xs text-muted-foreground">
          For delayed alerts, check that browser notifications and background activity are allowed
          in your phone settings.
        </p>
      )}
      {devices && (
        <div className="max-h-[35dvh] space-y-2 overflow-y-auto border-t pt-2">
          <p className="text-xs text-muted-foreground">
            {devices.length}/10 devices. Remove registrations you no longer use.
          </p>
          {devices.map((device, i) => (
            <div key={device.id} className="flex items-center justify-between gap-2 text-xs">
              <span>
                {device.endpoint === endpoint ? "This device" : `Device ${i + 1}`} ·{" "}
                {new Date(device.created_at).toLocaleDateString("en-IN")}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                className="min-h-11 shrink-0"
                onClick={() =>
                  void run(async () => {
                    if (device.endpoint === endpoint) {
                      await disablePush();
                      setStatus("off");
                    } else {
                      const { error } = await supabase
                        .from("push_subscriptions")
                        .delete()
                        .eq("id", device.id)
                        .eq("user_id", userId);
                      if (error) throw error;
                    }
                    await listDevices();
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
