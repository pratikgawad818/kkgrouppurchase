# Finance register completeness — 9 October 2026

**Risk:** A PostgREST response may return fewer rows than requested under a backend max-rows limit. Previously Vendor Invoices requested 2,000 and Payables requested 3,000 in one call, then aggregated the results. Financial totals could silently omit invoices.

**Improvement:** Both screens now read invoice rows with stable-ID secondary sorting in 250-row pages using `count: "exact"`. The helper verifies each page has the expected size, the count is stable, record IDs are unique, and total records do not exceed a 10,000-row browser safety limit. On uncertainty, the screen reports an error, not misleading totals, and offers Retry.

**Remaining limitations:** Multiple HTTP pages are not one PostgreSQL snapshot. Use database-side company-scoped aggregates for formal accounting or high-concurrency use. Other financial views may still have truncation and swallowed-error risks. This PR changes only source and CI; no live database write or Lovable publication.
