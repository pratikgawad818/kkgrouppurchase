# Dashboard performance: defer below-the-fold summaries

On dashboard startup the ERP previously mounted multiple query-heavy cards at
once. We now defer the **Purchase Requests, Purchase Orders, Goods Received,
Inventory and Vendor Payables** summaries until each is near the screen
(320px root margin), minimizing competition with first-screen queries.

Each component retains its existing SQL, filters, React Query cache keys,
permission gates, dates, financial logic and error handling. Once activated,
the section stays mounted. Keyboard and screen-reader users can activate
a section through an explicit **Load this section** button. Browsers without
IntersectionObserver load sections immediately.

The first-screen project selector, onboarding, quick actions, KPIs and recent
activity are still eager. Existing dashboard queries can still require
optimization for huge datasets; CI tests activation behavior, not measured
browser latency. Staging network/waterfall tests are required before claiming
a specific speedup. No Lovable credits, DB migrations or live deployment.
