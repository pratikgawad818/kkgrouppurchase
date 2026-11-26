import type { QueryClient } from "@tanstack/react-query";

// Brief reuse for reference lists only. Financial balances, permissions,
// duplicate checks and payment/GRN availability keep their own freshness rules.
export const FINANCE_REFERENCE_STALE_MS = 15_000;

export const FINANCE_REFERENCE_KEYS = {
  vendor: ["opening-bill-base","ledger-vendors","pay-base","vi-form-base"],
  project: ["opening-bill-base","pay-base","vi-form-base","workspace-projects"],
  building: ["opening-bill-base","vi-form-base"],
  bank: ["pay-base","payment-base"],
} as const;

export const FINANCE_SETTLEMENT_KEYS = [
  "vendor-payments","payables","vendor-invoices","vi","ledger",
  "accounts-task-queue","daily-workspace","director-pending-count","pay-open","adj-open",
  "opening-bill-duplicate-check","management-overview",
] as const;

export function invalidateFinanceKeys(client:QueryClient,keys:readonly string[]){
  return Promise.all([...new Set(keys)].map(key=>client.invalidateQueries({queryKey:[key]})));
}
