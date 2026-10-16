/** Push providers own these hosts; arbitrary HTTPS destinations are never safe. */
export function allowedPushEndpoint(value: string): boolean {
  if (value.length > 4096) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash)
      return false;
    if (url.hostname === "fcm.googleapis.com") return /^\/(?:fcm\/send|wp)\/.+/.test(url.pathname);
    if (url.hostname === "updates.push.services.mozilla.com")
      return /^\/wpush\/v[12]\/.+/.test(url.pathname);
    if (url.hostname === "web.push.apple.com") return url.pathname.length > 1;
    return (
      /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname) &&
      url.pathname === "/w/" &&
      !!url.search
    );
  } catch {
    return false;
  }
}

export function internalNotificationLink(value: string | null | undefined): string {
  if (
    !value ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes(String.fromCharCode(92)) ||
    [...value].some((char) => char.charCodeAt(0) <= 32)
  )
    return "/dashboard";
  return value;
}

export function matchingDispatchSecret(given: string, expected: string): boolean {
  if (!given || !expected || given.length > 512 || expected.length > 512) return false;
  let difference = given.length ^ expected.length;
  for (let i = 0; i < 512; i++)
    difference |= (given.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  return difference === 0;
}
