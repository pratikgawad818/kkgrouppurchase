import { isoDateToDisplay } from "./date-format.ts";

export type CalendarMonth = { year: number; month: number }; // month is 1–12

export function calendarMonth(iso: string): CalendarMonth {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

export function monthOffset(month: CalendarMonth, offset: number): CalendarMonth {
  const index = (month.year - 1) * 12 + month.month - 1 + offset;
  const bounded = Math.max(0, Math.min(9999 * 12 - 1, index));
  return { year: Math.floor(bounded / 12) + 1, month: bounded % 12 + 1 };
}

export function calendarDays({ year, month }: CalendarMonth): (string | null)[] {
  const first = new Date(0);
  first.setUTCFullYear(year, month - 1, 1);
  const result: (string | null)[] = Array.from({ length: (first.getUTCDay() + 6) % 7 }, () => null);
  const prefix = String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-";
  for (let day = 1; day <= 31; day++) {
    const iso = prefix + String(day).padStart(2, "0");
    if (isoDateToDisplay(iso)) result.push(iso);
  }
  return result;
}

export function calendarDateAllowed(iso: string, min?: string, max?: string): boolean {
  return !!isoDateToDisplay(iso) && (!min || iso >= min) && (!max || iso <= max);
}

export function calendarMonthAllowed(month: CalendarMonth, min?: string, max?: string): boolean {
  return calendarDays(month).some(day => day !== null && calendarDateAllowed(day, min, max));
}

export function initialCalendarMonth(selected: string | null, today: string, min?: string, max?: string): CalendarMonth {
  let iso = selected && isoDateToDisplay(selected) ? selected : today;
  if (min && iso < min) iso = min;
  if (max && iso > max) iso = max;
  return calendarMonth(iso);
}
