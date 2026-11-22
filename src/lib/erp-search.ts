/** Consistent, accent-/case-/separator-insensitive search for ERP registers.
 * Searches the *complete authorized result* before pagination. Every term can
 * match a different visible field, e.g. "city tanuj" or "PO 2026 0004".
 * This is presentation filtering only, not a substitute for database RLS.
 */
export function normalizedSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function matchesRecordSearch(values: readonly unknown[], search: string): boolean {
  const terms = normalizedSearchText(search).slice(0, 150).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const normalizedValues = values.map(normalizedSearchText);
  const allFields = normalizedValues.join(" ");
  // Allow either the readable punctuated reference "PO-2026-0004"
  // or an unpunctuated pasted reference "PO20260004".
  const compact = normalizedValues.map(s => s.replace(/\s/g, "")).join(" ");
  return terms.every(term => allFields.includes(term) || compact.includes(term));
}

/** Keep list paging within filtered results when async register data changes. */
export function visibleSearchPage(page: number, resultCount: number, size: number): number {
  if (!Number.isFinite(page) || !Number.isFinite(resultCount) || !Number.isFinite(size) || size <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(page)), Math.max(0, Math.ceil(resultCount / size) - 1));
}

/** Preserve common punctuation in direct search, but avoid accidental
 * PostgREST .or() syntax injection. Use only in OR filter construction.
 * For literal-text search, prefer matchesRecordSearch over this helper. */
export function safeOrSearch(input: string): string {
  return normalizedSearchText(input).slice(0, 100);
}
