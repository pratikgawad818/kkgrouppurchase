/** Indian financial year: 1 April – 31 March. Returns the starting year. */
export function fyOf(d: string | Date) {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.getMonth() >= 3 ? x.getFullYear() : x.getFullYear() - 1;
}
export function fyLabel(y: number) {
  return `FY ${y}–${String((y + 1) % 100).padStart(2, "0")}`;
}
export function fyOptions(dates: (string | null | undefined)[]) {
  const s = new Set<number>([fyOf(new Date())]);
  for (const d of dates) if (d) s.add(fyOf(d));
  return [...s].sort((a, b) => b - a);
}
export const PAGE = 25;
