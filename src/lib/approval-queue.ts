/** Fetch votes for currently pending documents, not arbitrary historical votes. */
export type ApprovalKind = "purchase_order" | "vendor_payment";
export type VoteFetchBatch = { kind: ApprovalKind; ids: string[] };

export function voteFetchChunks(
  requests: ReadonlyArray<{ kind: ApprovalKind; id: string }>,
  chunkSize = 50,
): VoteFetchBatch[] {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 100) {
    throw new Error("Invalid director vote query batch size.");
  }
  const batches: VoteFetchBatch[] = [];
  for (const kind of ["purchase_order", "vendor_payment"] as const) {
    const ids = [...new Set(requests.filter(request => request.kind === kind).map(request => request.id))];
    if (ids.some(id => !id)) throw new Error("Pending approval has no document identifier.");
    for (let i = 0; i < ids.length; i += chunkSize) {
      batches.push({ kind, ids: ids.slice(i, i + chunkSize) });
    }
  }
  return batches;
}

/** Never render thousands of approval cards on one screen. */
export function approvalPage<T>(
  rows: ReadonlyArray<T>,
  requestedPage: number,
  pageSize = 15,
): { items: T[]; page: number; total: number } {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error("Invalid approvals page size.");
  }
  const total = rows.length;
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const page = Number.isSafeInteger(requestedPage)
    ? Math.max(0, Math.min(requestedPage, lastPage))
    : 0;
  return { items: rows.slice(page * pageSize, (page + 1) * pageSize), page, total };
}
