# Mobile usability and shared controls — source-only

This change improves shared primitives used across KK GROUP ERP rather than
modifying individual financial or inventory business logic.

- **Touch controls:** buttons, input fields and select triggers have at least
  a 44px mobile target. Select options also have 44px touch height, returning
  to compact controls on desktop. Native select/input/textarea text uses
  16px on small screens to avoid iOS Safari zoom when focusing forms.
- **Dialogs and confirmations:** normal and alert dialogs have a viewport-width
  gutter and a max-height based on dynamic viewport height (dvh). On shorter
  screens they scroll internally, respecting bottom safe-area space. Action
  buttons stack and fill width on phones; desktop horizontal actions remain.
- **Sidebar sheets:** use dynamic viewport height and contain internal
  scrolling; content remains available in portrait/mobile landscape modes.
- **Pagination:** page navigation has two equal touch-friendly buttons,
  accurate accessible record ranges and previous/next labels. Buttons are
  explicitly `type=button`, so tapping a pager inside a form cannot submit
  the form. Display state clamps stale page numbers for safety. The caller
  must still clamp its data slice when filters shrink results.
- **Tests:** pure pager window tests cover normal, final, empty, filtered and
  invalid states. CI also verifies full production bundle, TypeScript, and
  existing ERP migration/finance/inventory regressions.

No DB/RLS changes, financial mutations, actual browsing of a published ERP,
Lovable credits, or production deployment. Real iOS/Android usability and
keyboard interaction require staging device testing.
