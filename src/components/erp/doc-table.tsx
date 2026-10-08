import { useEffect } from "react";

/**
 * Presentation-only: copies each column header's text onto its body cells (data-label)
 * inside `.doc-table` wrappers, so the same rendered rows can display as stacked cards
 * on phones via CSS. Does not touch data, queries or handlers.
 */
export function useDocTableLabels(root: () => HTMLElement | null) {
  useEffect(() => {
    const el = root();
    if (!el) return;
    const label = () => {
      el.querySelectorAll<HTMLTableElement>(".doc-table table").forEach((t) => {
        const heads = Array.from(t.tHead?.rows[0]?.cells ?? []).map((c) => c.textContent?.trim() ?? "");
        Array.from(t.tBodies).forEach((b) => Array.from(b.rows).forEach((r) => Array.from(r.cells).forEach((c, i) => {
          const v = c.colSpan > 1 ? "" : heads[i] ?? "";
          if (c.getAttribute("data-label") !== v) c.setAttribute("data-label", v);
        })));
      });
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [root]);
}
