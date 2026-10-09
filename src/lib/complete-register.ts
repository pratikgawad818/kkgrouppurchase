/**
 * Read finance rows in explicit pages and verify the exact row count.
 * Database APIs can cap responses even when a larger limit is requested.
 * This does not provide a transactionally consistent snapshot across HTTP pages.
 */
export async function loadCompleteRows<T extends { id: string }>(
  fetchPage: (start: number, end: number) => Promise<{
    data: T[] | null;
    count: number | null;
    error: { message: string } | null;
  }>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const { pageSize = 250, maxRows = 10000 } = options;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 ||
      !Number.isSafeInteger(maxRows) || maxRows < 1) {
    throw new Error("Finance register paging configuration is invalid.");
  }
  const rows: T[] = [];
  const seen = new Set<string>();
  let expected: number | null = null;
  while (true) {
    const start = rows.length;
    const end = start + Math.min(pageSize, maxRows - start) - 1;
    const { data, count, error } = await fetchPage(start, end);
    if (error) throw new Error(`Finance register could not be loaded: ${error.message}`);
    if (count === null || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("Finance register returned no reliable total count.");
    }
    if (expected === null) {
      expected = count;
      if (count > maxRows) throw new Error(`Finance register contains ${count} records, exceeding the ${maxRows}-row browser safety limit. Use a server-side report.`);
    } else if (count !== expected) {
      throw new Error("Finance register changed during loading. Refresh and retry.");
    }
    const required = Math.min(pageSize, expected - start);
    if (!Array.isArray(data) || data.length !== required) {
      throw new Error("Finance register response is incomplete or was capped by the database API. No totals can be shown safely.");
    }
    for (const row of data) {
      if (!row.id || seen.has(row.id)) {
        throw new Error("Finance register contained duplicate or invalid record IDs. Refresh and retry.");
      }
      seen.add(row.id);
    }
    rows.push(...data);
    if (rows.length === expected) return rows;
  }
}
