/**
 * Google OAuth refresh failure classification shared by the server and ERP UI.
 * Never persist or display the refresh token, Google response body or secrets.
 */
export const GOOGLE_REAUTHORIZE_ERROR =
  "Google authorization expired or was revoked. Reconnect Google in ERP Settings.";

export const GOOGLE_CLIENT_CONFIGURATION_ERROR =
  "Google OAuth client credentials were rejected. Check the configured Google client ID and secret.";

export type GoogleRefreshFailure = "reauthorize" | "configuration" | "retry";

export function classifyGoogleRefreshFailure(
  status: number,
  googleError: string | undefined,
): GoogleRefreshFailure {
  if (status === 400 && googleError === "invalid_grant") return "reauthorize";
  if (status === 400 && googleError === "invalid_client") return "configuration";
  return "retry";
}
