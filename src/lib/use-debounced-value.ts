import { useEffect, useState } from "react";

/** Avoid firing remote search queries for every individual keystroke. */
export function useDebouncedValue<T>(value: T, delayMs = 280): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
