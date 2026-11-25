import { useCallback, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";

/** Keep unsaved invoice entries in memory. No supplier or bank data is
 * persisted in browser storage. The ref also avoids a stale closure when
 * a successful save immediately navigates to the invoice details. */
export function useInvoiceEntryGuard() {
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setDirty(true);
  }, []);
  const markSaved = useCallback(() => {
    dirtyRef.current = false;
    setDirty(false);
  }, []);
  useBlocker({
    shouldBlockFn: () => dirtyRef.current &&
      !window.confirm("This invoice has unsaved entries. Leave without saving?"),
    enableBeforeUnload: () => dirtyRef.current,
  });
  return { dirty, markDirty, markSaved };
}
