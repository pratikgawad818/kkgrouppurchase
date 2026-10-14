// Username-only staff accounts sign in with a synthetic, non-deliverable email.
export const STAFF_LOGIN_DOMAIN = "staff.kkgroup.local";

export function normalizeUsername(u: string) {
  return u.trim().toLowerCase();
}

export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export function usernameToEmail(u: string) {
  return `${normalizeUsername(u)}@${STAFF_LOGIN_DOMAIN}`;
}

/** Accepts either a username or a real email address. */
export function loginToEmail(login: string) {
  const v = login.trim();
  return v.includes("@") ? v : usernameToEmail(v);
}

export function isSyntheticEmail(email: string | null | undefined) {
  return !!email && email.toLowerCase().endsWith("@" + STAFF_LOGIN_DOMAIN);
}
