import type { EmailProofSide } from "./email-otp";

// Global Web Crypto works in both the local runtime and the deployed worker.
export function makeEmailCode() {
  const bytes = new Uint32Array(1);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0]! >= 4_294_000_000);
  return String(bytes[0]! % 1_000_000).padStart(6, "0");
}

export async function hashEmailCode(
  secret: string,
  userId: string,
  id: string,
  side: EmailProofSide,
  email: string,
  code: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(JSON.stringify([userId, id, side, email.toLowerCase(), code])),
  );
  return Array.from(new Uint8Array(signed), (n) => n.toString(16).padStart(2, "0")).join("");
}
