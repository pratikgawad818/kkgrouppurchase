# Daily Workspace interface

The authenticated ERP now uses the selected white-and-teal option 1 direction.
The shared frame keeps all existing routes and permission checks, grouping pages
into Procurement, Inventory, Finance, Approvals, Projects and Settings.

- Desktop: grouped sidebar and page search.
- Tablet: compact rail opening the relevant expanded group.
- Phone: bottom navigation and a More bottom sheet. There is no phone side panel.
- Common components: consistent page hierarchy, focus states, readable values,
  touch controls, stacked document rows and progressively disclosed filters.

The dashboard reads real, RLS-scoped records, not mock data. Work lists request at
most eight records per accessible document type, with exact counts; the screen
shows at most six recent items and directs users to the full registers. Invoice
balances use verified complete paging. Failed reads show unavailable values.
Financial metrics are hidden when the account lacks the corresponding access.

Detailed summaries remain available behind Detailed overview, loaded only when
opened. Query caching avoids reloading the same dashboard on every navigation;
the date and project selection participate in cache keys. Table-label updates
are coalesced per animation frame and revisit affected tables rather than
repeatedly traversing the whole app.

`WorkspaceFrame` and `DailyWorkspace` are presentation components. The shell
retains route authorization, identity and sign-out; the route adapter supplies
live data. The temporary visual harness used during review is outside this
repository and is not a public route, login bypass or production dependency.

No database migration or business-data modification is part of this UI release.
Existing approvals, posting RPCs, stock records and ledger logic are unchanged.
See `design-qa.md` for validation evidence and limits. Publish the matching app
through the normal release process after merge; merge does not prove publication.
