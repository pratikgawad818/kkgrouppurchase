import test from "node:test";
import assert from "node:assert/strict";
import { calendarDays, calendarDateAllowed, calendarMonthAllowed, initialCalendarMonth, monthOffset } from "../../src/lib/date-calendar.ts";

test("month grid is Monday first and includes correct leap days", () => {
  const feb = calendarDays({ year: 2024, month: 2 });
  assert.deepEqual(feb.slice(0, 4), [null, null, null, "2024-02-01"]);
  assert.equal(feb.at(-1), "2024-02-29");
  assert.equal(calendarDays({year: 2025, month: 2}).at(-1), "2025-02-28");
  assert.equal(calendarDays({year: 2026, month: 12}).at(-1), "2026-12-31");
});
test("calendar navigation and inclusive bounds are date-only", () => {
  assert.deepEqual(monthOffset({year:2026,month:12},1), {year:2027,month:1});
  assert.deepEqual(monthOffset({year:2026,month:1},-1), {year:2025,month:12});
  assert.equal(calendarDateAllowed("2026-12-03","2026-12-01","2026-12-03"), true);
  assert.equal(calendarDateAllowed("2026-12-04","2026-12-01","2026-12-03"), false);
  assert.equal(calendarDateAllowed("2026-02-30"), false);
  assert.equal(calendarMonthAllowed({year:2026,month:11},"2026-12-01"), false);
  assert.deepEqual(initialCalendarMonth("2026-12-03","2026-11-26"),{year:2026,month:12});
  assert.deepEqual(initialCalendarMonth(null,"2026-11-26","2026-12-01"),{year:2026,month:12});
  assert.deepEqual(initialCalendarMonth(null,"2026-11-26",undefined,"2026-01-31"),{year:2026,month:1});
});
