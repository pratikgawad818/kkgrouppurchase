import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ maybeSingle: vi.fn(), rpc: vi.fn(), remove: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
      delete: () => ({ eq: mocks.remove }),
    }),
    rpc: mocks.rpc,
  },
}));

import { currentPushStatus, enablePush } from "../../src/lib/web-push";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function browser() {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  const old = { endpoint: "old", unsubscribe };
  const fresh = { endpoint: "new", toJSON: () => ({ keys: { p256dh: "key", auth: "auth" } }) };
  const subscribe = vi.fn().mockResolvedValue(fresh);
  const reg = { active: {}, pushManager: { getSubscription: vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(null), subscribe } };
  const win = { top: {}, self: {}, PushManager: {}, Notification: {}, matchMedia: () => ({ matches: false }) };
  win.top = win.self;
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { userAgent: "Chrome", serviceWorker: { getRegistration: vi.fn().mockResolvedValue(reg), register: vi.fn().mockResolvedValue(reg) } });
  vi.stubGlobal("Notification", { permission: "granted" });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ error: null });
  return { unsubscribe, subscribe };
}

test("a browser subscription missing from the account is not shown as enabled", async () => {
  browser();
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  expect(await currentPushStatus()).toBe("off");
});

test("turning on alerts renews an expired endpoint before registering the new one", async () => {
  const { unsubscribe, subscribe } = browser();
  expect(await enablePush()).toBe("on");
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith("register_my_push_subscription", {
    _endpoint: "new", _p256dh: "key", _auth: "auth",
  });
});