# Lovable Cloud publishing — Supabase runtime configuration

## Incident observed 9 October 2026

- Published site `https://kkgrouppurchase.lovable.app/auth` displayed a blank screen.
- Lovable's error log: `Missing Supabase environment variable(s): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY`.
- The frontend requires **`VITE_SUPABASE_URL`** and **`VITE_SUPABASE_PUBLISHABLE_KEY`** at *build time*. The SSR runtime can also use `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
- The repository had a `.gitignore` rule excluding the managed `.env`, and GitHub `main` contains **no tracked `.env`**. Lovable reported restoring values in its workspace, but its agent did not edit the `.gitignore`.
- Passing Vite build/TypeScript checks does **not** prove the deployed site has its environment variables.

## Code-side fix

The tracked `.gitignore` no longer ignores plain `.env` (other `.env.*` overrides remain ignored). Lovable's managed `.env`, if it contains **only public** keys, is now eligible to sync into GitHub/deployment builds.

A CI check `node scripts/check-public-env.mjs` reports **configured / missing** without printing values, and blocks non-public credentials accidentally checked into `.env`.

## Steps to restore the current website

1. Ensure the Lovable Cloud project `KK Bussiness` is connected to the existing database. **Do not change project/URL to another backend**.
2. Verify the **public** project URL and publishable/anon key are provided to the production *browser build* under `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The non-VITE equivalents are used only in the SSR fallback.
3. If Lovable maintains these values in a managed `.env`, confirm this file is present after syncing the fixed `.gitignore`, contains **only public values**, then run `node scripts/check-public-env.mjs --require`. Do **not** paste keys into chat.
4. Republish from the Lovable project's **Publish → Update** interface (publishing is separate from editing code). Verify `/auth` renders, password recovery renders, and sign-in reaches the dashboard; then use the browser console to check for remaining errors. On production, clear stale service-worker/cache if a previous script is still cached.
5. If the environment file still isn't included, configure **deployment environment variables** in the appropriate Lovable project settings or contact Lovable support for its managed runtime configuration. Do not hardcode project credentials into TypeScript to bypass deployment.

## Security rules

- **Public-only:** Supabase project URL/project ID and `sb_publishable_` key (or legacy `anon` JWT).
- **Never expose or commit:** service-role key, `sb_secret_` key, JWT signing secret, SQL credentials, SMTP credentials, provider tokens.
- Key names are not proof of safety; the validation script checks key format and detects common privileged values.
- All row-level-security policies remain enforced, regardless of whether a public anon key is embedded in the browser.
- The new code only fixes repository environment eligibility and diagnosis. It does **not** claim that the production site has already been republished or that its runtime is verified.
