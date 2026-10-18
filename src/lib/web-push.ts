import { supabase } from "@/integrations/supabase/client";

export const VAPID_PUBLIC_KEY =
  "BGUsTa0EAb9eYT3r1tNW9cOHAkhaVfCak-jut9ejFUdMhTL_si749PMOkGE5LIxi9qWGz0jH_Py7CTlU2Naj5uE";

export type PushStatus =
  "on" | "off" | "unsupported" | "open-in-new-tab" | "denied" | "install-first" | "unavailable";

function b64ToBytes(s: string) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function waitForActive(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return Promise.resolve();
  const w = reg.installing ?? reg.waiting;
  if (!w) return Promise.reject(new Error("Phone alert worker is unavailable. Please try again."));
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
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone;
  if (ios && !standalone) return "install-first";
  if (!window.isSecureContext) return "unsupported";
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

// Storage may be unavailable in private browsing; it must not break registration.
function setOptOut(userId: string, off: boolean) {
  try {
    if (off) localStorage.setItem(`push-off:${userId}`, "1");
    else localStorage.removeItem(`push-off:${userId}`);
  } catch {
    /* browser subscription still records the device's state */
  }
}
function optedOut(userId: string): boolean {
  try {
    return localStorage.getItem(`push-off:${userId}`) === "1";
  } catch {
    return false;
  }
}

/** Reconcile only opted-in devices; never prompt during workspace entry/focus. */
export async function ensureDirectorPush(isDirector: boolean): Promise<PushStatus> {
  const blocked = pushSupport();
  if (blocked) return blocked;
  if (Notification.permission !== "granted") return "off";
  const { data } = await supabase.auth.getUser();
  if (!data.user) return "off";
  if (optedOut(data.user.id)) return "off";
  const reg = await navigator.serviceWorker.getRegistration("/push-alerts/");
  const sub = await reg?.pushManager.getSubscription();
  if (!isDirector && !sub) return "off";
  return enablePush();
}

let pendingSetup: Promise<PushStatus> | null = null;

/** Permission is requested synchronously from the user's tap, before any I/O. */
export function enablePush(repair = false): Promise<PushStatus> {
  if (pendingSetup) return pendingSetup;
  const blocked = pushSupport();
  if (blocked) return Promise.resolve(blocked);
  const permission =
    Notification.permission === "granted"
      ? Promise.resolve("granted" as NotificationPermission)
      : Notification.requestPermission();
  pendingSetup = setup(permission, repair).finally(() => {
    pendingSetup = null;
  });
  return pendingSetup;
}

async function setup(
  permission: Promise<NotificationPermission>,
  repair: boolean,
): Promise<PushStatus> {
  if ((await permission) !== "granted") return "denied";
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) throw new Error("Sign in again to enable phone alerts.");
  if (repair) await detachPush();
  const reg = await navigator.serviceWorker.register("/push-sw.js", {
    scope: "/push-alerts/",
    updateViaCache: "none",
  });
  await waitForActive(reg);
  let sub = await reg.pushManager.getSubscription();
  const key = sub?.options?.applicationServerKey;
  const expected = b64ToBytes(VAPID_PUBLIC_KEY);
  if (
    sub &&
    ((sub.expirationTime && sub.expirationTime <= Date.now()) ||
      (key &&
        (key.byteLength !== expected.length ||
          new Uint8Array(key).some((byte, i) => byte !== expected[i]))))
  ) {
    await detachPush();
    sub = null;
  }
  const created = !sub;
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: expected,
  });
  const j = sub.toJSON();
  const { error } = await supabase.rpc("register_my_push_subscription", {
    _endpoint: sub.endpoint,
    _p256dh: j.keys?.["p256dh"] ?? "",
    _auth: j.keys?.["auth"] ?? "",
  });
  if (error) {
    // Failed account registration must not leave a phantom subscribed device.
    if (created) await sub.unsubscribe();
    throw error;
  }
  setOptOut(data.user.id, false);
  return "on";
}

export async function disablePush(): Promise<void> {
  // Finish an in-flight registration before removing it, so it cannot reappear after sign-out.
  await pendingSetup?.catch(() => {});
  await detachPush();
}

async function detachPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const { data } = await supabase.auth.getUser();
  if (data.user) setOptOut(data.user.id, true);
  const reg = await navigator.serviceWorker.getRegistration("/push-alerts/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  // Stop delivery in the browser even if the network/database is unavailable.
  const stopped = await sub.unsubscribe();
  if (!stopped) throw new Error("Could not stop this device's alerts. Please try again.");
  if (error) throw error;
}
