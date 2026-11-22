import { useEffect } from "react";
import { shiftWheelScrollTarget } from "@/lib/horizontal-scroll";

type ScrollArea = {
  onWheel: (event: WheelEvent) => void;
  addedTabIndex: boolean;
  addedRole: boolean;
  addedLabel: boolean;
};

/** Keep one semantic table on desktop, with header labels on its mobile cells.
 * Also make real overflowing register regions keyboard accessible and preserve
 * native horizontal trackpad scrolling on macOS. DOM work is frame-coalesced.
 */
export function useDocTableLabels(root: () => HTMLElement | null) {
  useEffect(() => {
    const el = root();
    if (!el) return;
    let frame = 0;
    const pending = new Set<HTMLTableElement>();
    const scrollAreas = new Map<HTMLElement, ScrollArea>();

    const release = (container: HTMLElement, area: ScrollArea) => {
      container.removeEventListener("wheel", area.onWheel);
      if (area.addedTabIndex) container.removeAttribute("tabindex");
      if (area.addedRole) container.removeAttribute("role");
      if (area.addedLabel) container.removeAttribute("aria-label");
      scrollAreas.delete(container);
    };

    const enhance = (table: HTMLTableElement) => {
      const container = table.parentElement;
      if (!container?.matches(".doc-table, .overflow-x-auto")) return;
      let area = scrollAreas.get(container);
      if (!area) {
        const onWheel = (event: WheelEvent) => {
          const target = shiftWheelScrollTarget(container, event);
          if (target === null || !event.cancelable) return;
          event.preventDefault();
          container.scrollLeft = target;
        };
        container.addEventListener("wheel", onWheel, { passive: false });
        area = {
          onWheel,
          addedTabIndex: false,
          addedRole: false,
          addedLabel: false,
        };
        scrollAreas.set(container, area);
      }

      // Native touchpad deltaX is handled by CSS overflow-x:auto. Do not
      // capture or modify it: that would break Mac trackpad momentum.
      const overflowing = container.scrollWidth > container.clientWidth + 1;
      if (overflowing) {
        if (!container.hasAttribute("tabindex")) {
          container.tabIndex = 0;
          area.addedTabIndex = true;
        }
        if (!container.hasAttribute("role")) {
          container.setAttribute("role", "region");
          area.addedRole = true;
        }
        if (!container.hasAttribute("aria-label")) {
          container.setAttribute("aria-label", "Horizontally scrollable table");
          area.addedLabel = true;
        }
      } else {
        if (area.addedTabIndex) {
          container.removeAttribute("tabindex");
          area.addedTabIndex = false;
        }
        if (area.addedRole) {
          container.removeAttribute("role");
          area.addedRole = false;
        }
        if (area.addedLabel) {
          container.removeAttribute("aria-label");
          area.addedLabel = false;
        }
      }
    };

    const collect = (node: Node) => {
      const element = node instanceof Element ? node : node.parentElement;
      if (!element) return;
      const table = element.closest<HTMLTableElement>(
        ".doc-table table, .overflow-x-auto > table",
      );
      if (table) pending.add(table);
      element
        .querySelectorAll<HTMLTableElement>(
          ".doc-table table, .overflow-x-auto > table",
        )
        .forEach((found) => pending.add(found));
    };

    const label = () => {
      frame = 0;
      for (const [container, area] of scrollAreas) {
        if (!container.isConnected) release(container, area);
      }
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
        enhance(table);
      }
      pending.clear();
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(label);
    };
    collect(el);
    label();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        collect(mutation.target);
        mutation.addedNodes.forEach(collect);
      }
      // Also release wheel listeners for tables removed on route change.
      if (pending.size || scrollAreas.size) schedule();
    });
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    const resize = () => {
      collect(el);
      schedule();
    };
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      if (frame) window.cancelAnimationFrame(frame);
      for (const [container, area] of scrollAreas) release(container, area);
    };
  }, [root]);
}
