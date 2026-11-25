import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FINANCE_REFERENCE_STALE_MS, FINANCE_REFERENCE_KEYS, FINANCE_SETTLEMENT_KEYS, invalidateFinanceKeys } from "../../src/lib/finance-cache.ts";
const read=p=>readFileSync(p,"utf8");
const route=p=>read("src/routes/_authenticated/_shell/"+p+".tsx");
test("finance cache uses short reference freshness and precise prefix invalidations",async()=>{
 assert.equal(FINANCE_REFERENCE_STALE_MS,15000);
 assert.ok(FINANCE_REFERENCE_KEYS.bank.includes("pay-base"));
 assert.ok(FINANCE_REFERENCE_KEYS.vendor.includes("ledger-vendors"));
 const calls=[];
 await invalidateFinanceKeys({invalidateQueries:async args=>calls.push(args.queryKey)},["pay-base","pay-base","ledger"]);
 assert.deepEqual(calls,[["pay-base"],["ledger"]]);
 for(const key of ["pay-open","adj-open","accounts-task-queue","daily-workspace","director-pending-count","opening-bill-duplicate-check"])assert.ok(FINANCE_SETTLEMENT_KEYS.includes(key));
});
test("reference caching never changes live invoice availability or auth verification",()=>{
 const old=route("finance.vendor-invoices.opening");
 assert.match(old,/queryKey: \["opening-bill-base"\],\s*staleTime: FINANCE_REFERENCE_STALE_MS/);
 assert.match(old,/queryKey: \["old-bill-materials"\],\s*staleTime: FINANCE_REFERENCE_STALE_MS/);
 assert.match(old,/queryKey: \["opening-bill-duplicate-check",h.vendor_id\],[\s\S]*?staleTime: 0/);
 assert.doesNotMatch(route("finance.payments.index"),/FINANCE_REFERENCE_STALE_MS/);
 assert.doesNotMatch(route("finance.vendor-invoices.new"),/FINANCE_REFERENCE_STALE_MS/);
 const root=read("src/routes/__root.tsx");
 assert.ok(root.includes("queryClient.clear()"));
 assert.ok(root.includes("invalidateVerifiedRouteUser()"));
});
test("master changes invalidate dependent selectors and settlements refresh task queues",()=>{
 for(const [page,key] of [["vendors","vendor"],["projects","project"],["buildings","building"],["settings.bank-accounts","bank"]])
   assert.ok(route(page).includes("invalidateFinanceKeys(qc,FINANCE_REFERENCE_KEYS."+key+")"),page);
 for(const page of ["finance.vendor-invoices.opening","finance.vendor-invoices.new","finance.vendor-invoices.$id","finance.payments.index"])
   assert.ok(route(page).includes("invalidateFinanceKeys(qc,FINANCE_SETTLEMENT_KEYS)"),page);
 assert.equal(route("settings.bank-accounts").split("invalidateFinanceKeys(qc,FINANCE_REFERENCE_KEYS.bank)").length-1,2);
});
