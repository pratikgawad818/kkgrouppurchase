# KK GROUP ERP — 9 October 2026 Lovable preview incident

## Evidence reviewed (read-only, without Lovable AI credits)

Source: Lovable project message/activity history and GitHub commits.

| Time (UTC) | Screen | Error | Evidence and disposition |
| --- | --- | --- | --- |
| 05:08 | `/auth` | Missing `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | Lovable restored the project's *public-only* Supabase environment. GitHub PR #12 fixed an overbroad ignore rule. The user subsequently reported the login screen rendered. |
| 06:10 | `/auth` | `Importing a module script failed.` | Lovable tested the preview and live route, then added a pre-hydration `vite:preloadError` / `error` / `unhandledrejection` listener (commit `714885d`). Stale cached JS after publication was suspected, not proven as the sole cause. |
| 06:12 | `/projects` | Same JavaScript module import error | Lovable inspected the preview log and fetched the route module. It reported that the module became available after a temporary dev server restart. No persistent Projects module syntax failure was established. |

These messages are *not* a complete historical production log or independent proof that every authenticated route currently works. User-level login, Projects, and invoice/PO UAT still need browser testing.

## GitHub-only hardening

The original stale-chunk handler retried after every 10 seconds. If a script URL remained unavailable (e.g. a broken deployment, network issue, offline device), that could lead to repeated browser reloads or another blank screen.

The new inline script (which runs before React hydration):

- Filters only known Vite/JavaScript/CSS chunk-import errors; business-logic errors are not auto-reloaded.
- Retries **once per URL path in a five-minute window**, using only a timestamp in tab-local `sessionStorage`.
- When another failure occurs within that window, shows an accessible recovery message and an explicit **Reload page** button.
- When browser privacy settings block sessionStorage, **does not automatically reload**, since loop prevention cannot be guaranteed.
- Uses DOM `textContent` for all messages, not dynamic HTML from an exception, and never sends user details to third parties.

`scripts/tests/stale-chunk-recovery.test.mjs` simulates stale imports, repeated failure, Vite preload events, blocked storage, separate routes and retry-window expiry in Node 24. It runs in GitHub Actions along with existing ERP unit tests, production build, and TypeScript checks.

## Still needed

- Confirm the latest GitHub code syncs to Lovable Cloud.
- **Publishing remains a separate user action**; don't consume Lovable AI credits to publish or troubleshoot.
- Open the published `/auth` and `/projects` in a fresh browser session and after a deployment, and confirm there is no blank-screen loop.
- If the new recovery screen is shown repeatedly, inspect the browser's Network tab for failed JavaScript chunk URLs and the Cloud hosting/deployment status. Do not assume it is harmless.
