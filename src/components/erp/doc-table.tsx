import { useEffect } from "react";

/** Keep one semantic table on desktop, with header labels on its mobile cells.
 * Changes are coalesced per frame and only affected tables are revisited. */
export function useDocTableLabels(root: () => HTMLElement | null) {
  useEffect(() => {
    const el = root();
    if (!el) return;
    let frame = 0;
    const pending = new Set<HTMLTableElement>();
    const collect = (node: Node) => {
      const element = node instanceof Element ? node : node.parentElement;
      if (!element) return;
      const table = element.closest<HTMLTableElement>(".doc-table table");
      if (table) pending.add(table);
      element
        .querySelectorAll<HTMLTableElement>(".doc-table table")
        .forEach((table) => pending.add(table));
    };
    const label = () => {
      frame = 0;
      for (const table of pending) {
        if (!table.isConnected) continue;
        const headers = Array.from(table.tHead?.rows[0]?.cells ?? []).map(
          (cell) => cell.textContent?.trim() ?? "",
        );
        Array.from(table.tBodies).forEach((body) =>
          Array.from(body.rows).forEach((row) =>
            Array.from(row.cells).forEach((cell, index) => {
              const value = cell.colSpan > 1 ? "" : (headers[index] ?? "");
              if (cell.getAttribute("data-label") !== value) cell.setAttribute("data-label", value);
            }),
          ),
        );
      }
      pending.clear();
    };
    collect(el);
    label();
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        collect(mutation.target);
        mutation.addedNodes.forEach(collect);
      }
      if (pending.size && !frame) frame = window.requestAnimationFrame(label);
    });
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [root]);
}
