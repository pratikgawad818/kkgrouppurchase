/**
 * Browser-only, short-lived deduplication for verified Supabase getUser calls.
 *
 * This is a ROUTING optimization, never authorization. PostgreSQL RLS and
 * authenticated RPCs still verify the real access token on EVERY data request.
 * Null/error results are deliberately NOT cached, and auth transitions must
 * invalidate the cache so a prior user's identity cannot be reused.
 */
export function makeVerifiedUserCache<T>(
  verify: () => Promise<T | null>,
  now: () => number = Date.now,
  ttlMs = 12_000,
) {
  let cached: T | null = null;
  let expiresAt = 0;
  let inFlight: Promise<T | null> | null = null;
  let generation = 0;

  function invalidate() {
    generation++;
    cached = null;
    expiresAt = 0;
    inFlight = null;
  }

  function get(): Promise<T | null> {
    if (cached !== null && now() < expiresAt) return Promise.resolve(cached);
    if (inFlight !== null) return inFlight;
    const requestedGeneration = generation;
    const current = Promise.resolve()
      .then(verify)
      .then((user) => {
        // Reject an obsolete result if logout, login or user update happened
        // while the verification call was still in flight.
        if (requestedGeneration !== generation) return null;
        if (user !== null) {
          cached = user;
          expiresAt = now() + ttlMs;
        }
        return user;
      })
      .finally(() => {
        if (inFlight === current) inFlight = null;
      });
    inFlight = current;
    return current;
  }

  return { get, invalidate };
}
