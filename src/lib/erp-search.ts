/** Consistent, accent-/case-/separator-insensitive search for ERP registers.
 * Searches the *complete authorized result* before pagination. Every term can
 * match a different visible field, e.g. "city tanuj" or "PO 2026 0004".
 * This is presentation filtering only, not a substitute for database RLS.
 */
export function normalizedSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Prepare once per filter pass; no shared cache of sensitive record data. */
export type PreparedRecordSearch = { readonly terms: readonly string[] };
export function prepareRecordSearch(search:string):PreparedRecordSearch {
  return {terms:normalizedSearchText(search).slice(0,150).split(" ").filter(Boolean)};
}
export function matchesRecordSearch(values: readonly unknown[], search: string | PreparedRecordSearch): boolean {
  const terms = typeof search === "string" ? prepareRecordSearch(search).terms : search.terms;
  if (!terms.length) return true;
  const normalizedValues = values.map(normalizedSearchText);
  const allFields = normalizedValues.join(" ");
  const missing = terms.filter(term => !allFields.includes(term));
  if (!missing.length) return true;
  // Only construct compact references when the normal text did not match.
  const compact = normalizedValues.map(s => s.replace(/\s/g, "")).join(" ");
  return missing.every(term => compact.includes(term));
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
