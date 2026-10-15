// Phone notification worker: shows alerts in the phone's notification bar.
// It does not cache any app pages.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "KK GROUP ERP", body: event.data ? event.data.text() : "" }; }
  const show = self.registration.showNotification(d.title || "KK GROUP ERP", {
    body: d.body || "",
    icon: "/apple-touch-icon.png",
    badge: "/favicon.png",
    tag: d.tag,
    data: { link: d.link || "/dashboard" },
  });
  const badge = self.navigator && self.navigator.setAppBadge && typeof d.badge === "number"
    ? (d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {})
    : Promise.resolve();
  event.waitUntil(Promise.all([show, badge]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.link) || "/dashboard", self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) { await c.focus(); return c.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
