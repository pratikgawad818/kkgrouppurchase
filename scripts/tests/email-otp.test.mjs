import test from "node:test";
import assert from "node:assert/strict";
import { makeEmailCode, hashEmailCode } from "../../src/lib/email-otp-crypto.ts";
import { cleanEmailCode, maskEmail } from "../../src/lib/email-otp.ts";

test("OTP generation is six digits and HMAC proofs bind user, request, inbox and destination", async () => {
  const codes = new Set(Array.from({ length: 100 }, makeEmailCode));
  assert.ok(codes.size > 90);
  for (const code of codes) assert.match(code, /^\d{6}$/);
  const args = ["test-server-secret", "user-a", "request-a", "new", "alice@example.test", "012345"];
  const hash = await hashEmailCode(...args);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(await hashEmailCode(...args), hash);
  for (const [i, value] of [[0,"other-secret"],[1,"user-b"],[2,"request-b"],[3,"old"],[4,"bob@example.test"],[5,"012346"]]) {
    const changed = [...args]; changed[i] = value;
    assert.notEqual(await hashEmailCode(...changed), hash);
  }
});
test("mobile code entry accepts pasted codes without losing leading zeroes", () => {
  assert.equal(cleanEmailCode("0 1-23 45"), "012345");
  assert.equal(cleanEmailCode("123456789"), "123456");
  assert.equal(cleanEmailCode("hello"), "");
  assert.equal(maskEmail("alex@example.test"), "al•••@example.test");
});
