/** Optional Shift + vertical wheel support for horizontally overflowing tables.
 * Native deltaX from Mac trackpads and Magic Mouse is deliberately NOT
 * intercepted; that gesture must keep browser momentum and inertia.
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

export function shiftWheelScrollTarget(
  state: HorizontalScrollState,
  event: WheelScrollIntent,
): number | null {
  const max = Math.max(0, state.scrollWidth - state.clientWidth);
  if (
    max <= 1 ||
    !event.shiftKey ||
    event.ctrlKey || event.metaKey || event.altKey ||
    !Number.isFinite(event.deltaY) ||
    Math.abs(event.deltaY) <= Math.abs(event.deltaX)
  ) return null;

  const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? state.clientWidth : 1;
  const target = Math.max(0, Math.min(max, state.scrollLeft + event.deltaY * unit));
  // Do not steal vertical or browser navigation when there is no room to move.
  return target === state.scrollLeft ? null : target;
}
