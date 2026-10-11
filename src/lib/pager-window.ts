/**
 * Keep visual paging within a valid range after a filter narrows a register.
 * This is display-only; it does not alter Supabase queries or record counts.
 */
export function pagerWindow(total: number, size: number, requestedPage: number) {
  if (!Number.isSafeInteger(total) || total < 0 ||
      !Number.isSafeInteger(size) || size <= 0 ||
      !Number.isSafeInteger(requestedPage)) {
    throw new Error("Invalid pagination parameters.");
  }
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.max(0, Math.min(requestedPage, pages - 1));
  return {
    page,
    pages,
    first: total === 0 ? 0 : page * size + 1,
    last: Math.min(total, (page + 1) * size),
    hasPrevious: page > 0,
    hasNext: page < pages - 1,
  };
}
