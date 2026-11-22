/** Horizontal scrolling for wide ERP table regions on Mac/Windows.
 *
 * Browser native horizontal wheel handling can yield to back/forward swipe
 * history on some Mac browsers, especially in one direction. For *scrollable
 * tables only* we consume horizontal wheel events and move their own
 * scrollLeft in both directions. Vertical scrolling and browser zoom remain
 * native. This makes reverse (negative deltaX) movement deterministic.
 */
export interface HorizontalScrollState {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

export interface WheelScrollIntent {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}

/** Returns null when the event should pass through normally.
 * A returned position means the caller must preventDefault on a cancelable
 * wheel event, including at the left/right edge: otherwise the browser may
 * reinterpret the gesture as navigating Back or Forward.
 */
export function tableWheelScrollTarget(
  state: HorizontalScrollState,
  event: WheelScrollIntent,
): number | null {
  const max = Math.max(0, state.scrollWidth - state.clientWidth);
  if (
    max <= 1 ||
    event.ctrlKey || event.metaKey || event.altKey ||
    !Number.isFinite(event.deltaX) || !Number.isFinite(event.deltaY)
  ) return null;

  const horizontal = Math.abs(event.deltaX) > 0 &&
    Math.abs(event.deltaX) >= Math.abs(event.deltaY) * 0.75;
  const shiftedVertical = event.shiftKey && !horizontal && Math.abs(event.deltaY) > 0;
  if (!horizontal && !shiftedVertical) return null;

  const delta = horizontal ? event.deltaX : event.deltaY;
  const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? state.clientWidth : 1;
  const position = Math.min(max, Math.max(0, state.scrollLeft));
  return Math.max(0, Math.min(max, position + delta * unit));
}

/** Legacy Shift + mouse-wheel helper: no interception at the scroll edges.
 * Use tableWheelScrollTarget in the actual table wheel handler so the
 * browser cannot hijack a reverse gesture for history navigation.
 */
export function shiftWheelScrollTarget(
  state: HorizontalScrollState,
  event: WheelScrollIntent,
): number | null {
  if (!event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return null;
  const target = tableWheelScrollTarget(state, event);
  return target === state.scrollLeft ? null : target;
}
