/**
 * Checks that the Lovable-managed .env (if present) contains only public
 * Supabase browser configuration. Never prints values or tokens.
 *
 * CI without .env: warn, because the build may receive Lovable-managed
 * variables at publish time. --require: fail unless both public VITE_ vars exist.
 */
import { existsSync, readFileSync } from "node:fs";

const allowedKeys = new Set([
  "SUPABASE_PROJECT_ID",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PROJECT_ID",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
]);
const requireConfig = process.argv.includes("--require");
const filename = ".env";
const env = { ...process.env };
const violations = [];

if (existsSync(filename)) {
  const text = readFileSync(filename, "utf8");
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      violations.push(`Unexpected syntax in .env at line ${index + 1}`);
      continue;
    }
    const [, key, input] = match;
    if (!allowedKeys.has(key)) {
      violations.push(`Non-public or unexpected environment key in .env at line ${index + 1}`);
      continue;
    }
    const value = input.trim().replace(/^(['"])(.*)\1$/, "$2");
    env[key] = value;
    if (/sb_secret_|service_role|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i.test(value)) {
      violations.push(`A secret or privileged credential is present at line ${index + 1}`);
    }
    // Older Supabase anon keys are JWTs; decoding the payload does not verify
    // signatures, but helps prevent accidentally publishing service_role keys.
    if (key.endsWith("PUBLISHABLE_KEY") && value.split(".").length === 3) {
      try {
        const claim = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
        if (claim.role !== "anon") violations.push(`Non-anon JWT key detected at line ${index + 1}`);
      } catch {
        violations.push(`Malformed JWT API key at line ${index + 1}`);
      }
    }
    if (key.endsWith("PUBLISHABLE_KEY") && value && !value.startsWith("sb_publishable_") && value.split(".").length !== 3) {
      violations.push(`Unexpected publishable API key format at line ${index + 1}`);
    }
  }
}

const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (url && (!url.startsWith("https://") || !URL.canParse(url))) violations.push("VITE_SUPABASE_URL must be a valid HTTPS URL");

const ready = !!url && !!key;
if (requireConfig && !ready) violations.push(
  "Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Lovable must provide public browser configuration before publishing."
);
if (violations.length) {
  for (const v of violations) console.error(`ERROR: ${v}`);
  process.exitCode = 1;
} else {
  console.log(ready
    ? "PASS: browser Supabase URL and publishable key are configured (values hidden)."
    : "WARN: browser Supabase environment is absent in this checkout. Build/typecheck can pass, but published /auth will fail without Lovable-managed VITE_ values."
  );
}
