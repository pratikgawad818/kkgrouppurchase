# Purchase workflow search responsiveness — source-only

Search inputs in the Purchase Request and RFQ registers previously caused an
immediate new server query for every keystroke. They now debounce the text
value for **280 milliseconds**. Other filters, status changes, permissions
and pagination continue to update immediately. No server-side query logic or
search scope is widened, and normal Supabase RLS still applies.

The Purchase Orders page searches a local 2000-order dataset with nested line
items. It now uses React's deferred input value and memoizes the filtered
result, so unrelated rerenders and pagination do not repeatedly scan the
entire material-line collection.

These are **responsiveness changes**, not a guarantee of accurate totals for
databases exceeding the existing 2000-record PO query limit. A future
reviewed server-side pagination/filter implementation is recommended. This
PR changes no financial calculations, supplier records, DB migrations,
Lovable credits or live deployments. CI validates TypeScript and production
build; authenticated browser typing/network tests remain pending.
