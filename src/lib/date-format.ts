/**
 * Human-readable dates across KK GROUP ERP use DD/MM/YYYY.
 *
 * Database and API values remain ISO 8601 (YYYY-MM-DD / UTC timestamps);
 * never write formatted display values to PostgreSQL or compare them as dates.
 * Date-only values are formatted from their calendar components to avoid
 * timezone-dependent off-by-one errors.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DISPLAY_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const erpDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const erpTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

function validDate(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 ||
      day < 1 || day > 31) return false;
  const checked = new Date(0);
  checked.setUTCFullYear(year, month - 1, day);
  checked.setUTCHours(0, 0, 0, 0);
  return checked.getUTCFullYear() === year &&
    checked.getUTCMonth() === month - 1 &&
    checked.getUTCDate() === day;
}

export function isoDateToDisplay(value: string | null | undefined): string {
  if (!value) return "";
  const match = ISO_DATE.exec(value);
  if (!match) return "";
  const [, y, m, d] = match;
  if (!validDate(Number(y), Number(m), Number(d))) return "";
  return `${d}/${m}/${y}`;
}

/**
 * iPhone's numeric keyboard may not expose "/". Accept eight typed digits
 * (or a pasted display/ISO date) and progressively show DD/MM/YYYY.
 * This is only display formatting; a full valid date is still required
 * before displayDateToIso() returns an API value.
 */
export function formatDateEntryInput(raw: string): string {
  const pastedIso = isoDateToDisplay(raw.trim());
  if (pastedIso) return pastedIso;
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Strict date entry: rejects 31/02/2026, incorrect year and ambiguities. */
export function displayDateToIso(value: string): string | null {
  const match = DISPLAY_DATE.exec(value.trim());
  if (!match) return null;
  const [, d, m, y] = match;
  if (!validDate(Number(y), Number(m), Number(d))) return null;
  return `${y}-${m}-${d}`;
}

export function formatErpDate(value: string | null | undefined): string {
  if (!value) return "—";
  const dateOnly = isoDateToDisplay(value);
  if (dateOnly) return dateOnly;
  if (ISO_DATE.test(value)) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : erpDateFormatter.format(date);
}

export function formatErpDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${erpDateFormatter.format(date)}, ${erpTimeFormatter.format(date)}`;
}
