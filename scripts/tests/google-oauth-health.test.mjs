import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyGoogleRefreshFailure,
  GOOGLE_REAUTHORIZE_ERROR,
  GOOGLE_CLIENT_CONFIGURATION_ERROR,
} from "../../src/lib/google-oauth-health.ts";

test("expired or revoked Google token requires reauthorization", () => {
  assert.equal(classifyGoogleRefreshFailure(400,"invalid_grant"),"reauthorize");
  assert.match(GOOGLE_REAUTHORIZE_ERROR,/Reconnect Google/);
});
test("invalid client credentials are deployment errors, not user token errors", () => {
  assert.equal(classifyGoogleRefreshFailure(400,"invalid_client"),"configuration");
  assert.match(GOOGLE_CLIENT_CONFIGURATION_ERROR,/client/);
});
test("transient failures do not disable a connection", () => {
  assert.equal(classifyGoogleRefreshFailure(500,"server_error"),"retry");
  assert.equal(classifyGoogleRefreshFailure(429,"rate_limit_exceeded"),"retry");
  assert.equal(classifyGoogleRefreshFailure(400,"invalid_request"),"retry");
  assert.equal(classifyGoogleRefreshFailure(401,undefined),"retry");
});
