import { isoDateToDisplay } from "./date-format.ts";
export const PR_NOTICE_DAYS = 7;
export const prToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0,10);
export function prNotice(requiredBy: string, itemDates: readonly string[], submittedOn = prToday()) {
  if (!isoDateToDisplay(requiredBy) || !isoDateToDisplay(submittedOn)) return null;
  const due = [requiredBy, ...itemDates.filter(date => !!isoDateToDisplay(date))].sort()[0]!;
  const days = Math.round((Date.parse(due) - Date.parse(submittedOn))/86400000);
  return { due, submittedOn, days, shortfall: Math.max(0, PR_NOTICE_DAYS-days), late: days < PR_NOTICE_DAYS };
}
export function noticeReasonValid(reason: string) { return reason.trim().length >= 10 && reason.trim().length <= 1000; }
