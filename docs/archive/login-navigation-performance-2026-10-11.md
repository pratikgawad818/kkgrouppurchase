# KK GROUP ERP — login and shared navigation performance (source-only)

The ERP uses TanStack Router/Start, React Query, and Supabase. This changes
**shared** route/auth handling, rather than rewriting dozens of screens.

## Improvements

- A short **12-second, in-memory verification cache** deduplicates
  `supabase.auth.getUser()` when switching protected pages or preloading a
  destination. Null/failed results are not cached. `SIGNED_IN`,
  `SIGNED_OUT`, `USER_UPDATED` and `TOKEN_REFRESHED` invalidate the cache.
  Responses from a pre-logout verification are discarded if they finish after
  a new auth transition.
- Backend authorization is unchanged: Supabase RLS and authenticated RPCs
  still verify user/role/company membership for each data request. A cached
  browser identity is NEVER used to decide table/RPC permission.
- Root auth listener no longer triggers an unscoped refetch of *every* cached
  ERP query on same-user profile updates. Cross-user sign-in and sign-out
  clear all tenant-sensitive React Query data.
- Sidebar links preload their route modules on hover/focus (120ms intent
  threshold), with a 15s preload lifetime. No permission bypass: route guard
  and sidebar permissions remain unchanged.
- A thin non-layout-shifting loading indicator appears while route transitions
  are in progress; session checking on the sign-in page shows a compact
  placeholder rather than flickering the login form before redirect.
- Auth cache deduplication, TTL, pending invalidation and negative/error
  behavior have automated tests.

## Safety / limitations

- No optimistic financial posting, hidden background mutation, or client-side
  RLS bypass. Cached data for a different login is **cleared**, not reused.
- No global disabling of focus-based refetch or longer stale window for stock
  and finance queries. Those retain their existing freshness policies.
- Browser/API latency, connection quality and database indexing still affect
  page load. This improves the shared overhead but does **not** prove every
  screen loads instantly.
- Browser-performance tests (slow network, real credentials, mobile touch,
  route navigation, logout/login account switch and link preloads) remain
  a staging acceptance requirement before the owner publishes.
- GitHub CI uses build, TypeScript and pure cache tests. No Lovable credits,
  external database modification, real Meta API call or production deployment.
