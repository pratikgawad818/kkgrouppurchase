/** Typing for database functions defined in repo migrations not yet applied to the live database. */
export type PendingRpc<T> = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: T | null; error: Error | null }>;
