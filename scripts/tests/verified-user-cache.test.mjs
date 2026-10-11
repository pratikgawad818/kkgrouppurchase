import test from "node:test";
import assert from "node:assert/strict";
import { makeVerifiedUserCache } from "../../src/lib/verified-user-cache.ts";

test("deduplicates simultaneous route verification and caches only for the short TTL", async () => {
  let now=1000, calls=0;
  const guard=makeVerifiedUserCache(async () => { calls++; return { id:"user-a" }; },()=>now,12_000);
  const [one,two,three] = await Promise.all([guard.get(),guard.get(),guard.get()]);
  assert.equal(calls,1);
  assert.equal(one.id,"user-a");
  assert.equal(two.id,"user-a");
  assert.equal(three.id,"user-a");
  now+=11_999;
  assert.equal((await guard.get()).id,"user-a");
  assert.equal(calls,1);
  now+=1;
  await guard.get();
  assert.equal(calls,2);
});

test("auth transition drops cache and refuses old in-flight verification result", async () => {
  let complete;
  let calls=0;
  const guard=makeVerifiedUserCache(()=>{
    calls++;
    if(calls===1) return new Promise(resolve=>{complete=resolve;});
    return Promise.resolve({id:"user-b"});
  });
  const old=guard.get();
  await Promise.resolve(); // allow promise callback to create the old request
  guard.invalidate(); // sign-out / user-switch while getUser is pending
  const fresh=guard.get();
  complete({id:"user-a"});
  assert.equal(await old,null);
  assert.deepEqual(await fresh,{id:"user-b"});
  assert.deepEqual(await guard.get(),{id:"user-b"});
  assert.equal(calls,2);
});

test("never cache anonymous or failed verification; retry is possible immediately", async () => {
  let attempts=0;
  const guard=makeVerifiedUserCache(async()=>{
    attempts++;
    if(attempts===1) return null;
    if(attempts===2) throw new Error("temporary network failure");
    return {id:"user-c"};
  });
  assert.equal(await guard.get(),null);
  await assert.rejects(guard.get(),/network failure/);
  assert.deepEqual(await guard.get(),{id:"user-c"});
  assert.equal(attempts,3);
});
