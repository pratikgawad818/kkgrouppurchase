import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{(error as Error)?.message || "Please try again."}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "KK Group ERP" },
      { name: "description", content: "Internal operations ERP for KK Group projects, procurement, inventory, costing and finance." },
      { property: "og:title", content: "KK Group ERP" },
      { property: "og:description", content: "Internal operations ERP for KK Group projects, procurement, inventory, costing and finance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// A stale deployed JavaScript/CSS chunk can fail before React hydrates. The
// inline handler must work without React and must never endlessly auto-reload.
const STALE_CHUNK_RECOVERY = `(function () {
  var ERROR_PATTERN = /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS|Loading chunk [0-9]+ failed|ChunkLoadError/i;
  var RETRY_WINDOW = 5 * 60 * 1000;
  var recoveryStarted = false;

  function isChunkError(message) {
    return ERROR_PATTERN.test(String(message || ""));
  }

  function showRecoveryNotice() {
    function mount() {
      if (document.getElementById("kk-chunk-recovery")) return;

      var backdrop = document.createElement("div");
      backdrop.id = "kk-chunk-recovery";
      backdrop.setAttribute("role", "alert");
      backdrop.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:#f8fafc;color:#0f172a;font:15px/1.5 system-ui,sans-serif";

      var card = document.createElement("div");
      card.style.cssText = "width:min(100%,420px);background:white;border:1px solid #cbd5e1;border-radius:14px;padding:28px;box-shadow:0 14px 40px #0f172a14";

      var heading = document.createElement("h1");
      heading.textContent = "The latest version could not load";
      heading.style.cssText = "font-size:20px;font-weight:700;margin:0 0 8px";

      var detail = document.createElement("p");
      detail.textContent = "The app was updated, but your browser could not load a page file. Check your connection, then try reloading. If the problem persists, contact your ERP administrator.";
      detail.style.cssText = "margin:0 0 18px;color:#475569";

      var action = document.createElement("button");
      action.type = "button";
      action.textContent = "Reload page";
      action.style.cssText = "min-height:44px;padding:10px 18px;border:0;border-radius:8px;background:#1d4ed8;color:white;font:600 14px system-ui,sans-serif;cursor:pointer";
      action.addEventListener("click", function () { window.location.reload(); });

      card.appendChild(heading);
      card.appendChild(detail);
      card.appendChild(action);
      backdrop.appendChild(card);
      document.body.appendChild(backdrop);
      action.focus();
    }

    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
  }

  function retryOnce(event) {
    if (event && event.type === "vite:preloadError" && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (recoveryStarted) return;
    recoveryStarted = true;

    // One automatic retry per route per five minutes. Persistent failures
    // show a recovery message instead of an infinite reload loop.
    var key = "kk-chunk-retry:" + window.location.pathname;
    try {
      var lastAttempt = Number(window.sessionStorage.getItem(key)) || 0;
      if (Date.now() - lastAttempt < RETRY_WINDOW) {
        showRecoveryNotice();
        return;
      }
      window.sessionStorage.setItem(key, String(Date.now()));
    } catch (error) {
      // With storage blocked, no cross-reload guard is possible; fail safely.
      showRecoveryNotice();
      return;
    }
    window.location.reload();
  }

  window.addEventListener("vite:preloadError", retryOnce);
  window.addEventListener("error", function (event) {
    if (isChunkError(event && event.message)) retryOnce();
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    if (isChunkError(reason && reason.message || reason)) retryOnce();
  });
})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: STALE_CHUNK_RECOVERY }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
