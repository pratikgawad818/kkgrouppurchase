import { supabase } from "@/integrations/supabase/client";

export const VAPID_PUBLIC_KEY =
  "BGUsTa0EAb9eYT3r1tNW9cOHAkhaVfCak-jut9ejFUdMhTL_si749PMOkGE5LIxi9qWGz0jH_Py7CTlU2Naj5uE";

export type PushStatus =
  "on" | "off" | "unsupported" | "open-in-new-tab" | "denied" | "install-first";

function b64ToBytes(s: string) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function waitForActive(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return Promise.resolve();
  const w = reg.installing ?? reg.waiting;
  if (!w) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("Phone alert setup timed out. Please try again.")),
      15000,
    );
    w.addEventListener("statechange", () => {
      if (w.state === "activated") {
        clearTimeout(t);
        resolve();
      }
      if (w.state === "redundant") {
        clearTimeout(t);
        reject(new Error("Phone alert setup failed. Please try again."));
      }
    });
  });
}

export function pushSupport(): PushStatus | null {
  if (typeof window === "undefined") return "unsupported";
  if (window.top !== window.self) return "open-in-new-tab";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone;
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return ios && !standalone ? "install-first" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  return null;
}

export async function currentPushStatus(): Promise<PushStatus> {
  const blocked = pushSupport();
  if (blocked) return blocked;
  const reg = await navigator.serviceWorker.getRegistration("/push-alerts/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub || Notification.permission !== "granted") return "off";
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", sub.endpoint)
    .maybeSingle();
  if (error) throw error;
  return data ? "on" : "off";
}

/** Must be called from a tap/click. */
export async function enablePush(): Promise<PushStatus> {
  const blocked = pushSupport();
  if (blocked) return blocked;
  const perm =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (perm !== "granted") return "denied";
  // Permission must be requested during the tap before awaiting subscription cleanup.
  // Renew expired browser endpoints instead of registering the same dead one again.
  await disablePush();
  const reg = await navigator.serviceWorker.register("/push-sw.js", { scope: "/push-alerts/" });
  // navigator.serviceWorker.ready never resolves here (the worker's scope doesn't cover this page),
  // so wait for this registration's own worker to activate.
  await waitForActive(reg);
  let sub = await reg.pushManager.getSubscription();
  if (!sub)
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY),
    });
  const j = sub.toJSON();
  const { error } = await supabase.rpc("register_my_push_subscription", {
    _endpoint: sub.endpoint,
    _p256dh: j.keys?.["p256dh"] ?? "",
    _auth: j.keys?.["auth"] ?? "",
  });
  if (error) throw error;
  return "on";
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/push-alerts/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
}
