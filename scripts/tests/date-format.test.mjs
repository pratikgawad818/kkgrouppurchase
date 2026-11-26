import test from "node:test";
import assert from "node:assert/strict";
import {
  isoDateToDisplay, displayDateToIso, formatDateEntryInput, formatErpDate, formatErpDateTime,
} from "../../src/lib/date-format.ts";

test("date-only formatting always uses DD/MM/YYYY without UTC day shifts", () => {
  assert.equal(formatErpDate("2026-11-19"), "19/11/2026");
  assert.equal(formatErpDate("2026-01-03"), "03/01/2026");
  assert.equal(isoDateToDisplay("2024-02-29"), "29/02/2024");
  assert.equal(formatErpDate("2026-02-31"), "—");
  assert.equal(formatErpDate(""), "—");
  assert.equal(formatErpDate("not-a-date"), "—");
});

test("date entry converts valid DD/MM/YYYY to ISO without changing saved schema", () => {
  assert.equal(displayDateToIso("19/11/2026"), "2026-11-19");
  assert.equal(displayDateToIso("03/01/2026"), "2026-01-03");
  assert.equal(displayDateToIso(" 29/02/2024 "), "2024-02-29");
  assert.equal(displayDateToIso("31/02/2026"), null);
  assert.equal(displayDateToIso("29/02/2025"), null);
  assert.equal(displayDateToIso("19/13/2026"), null);
  assert.equal(displayDateToIso("2026-11-19"), null);
  assert.equal(displayDateToIso("1/1/2026"), null);
  assert.equal(displayDateToIso(""), null);
});

test("timestamps use Asia/Kolkata clock with DD/MM/YYYY", () => {
  assert.equal(formatErpDate("2026-11-18T20:00:00Z"), "19/11/2026");
  assert.match(formatErpDateTime("2026-11-18T20:00:00Z"), /^19\/11\/2026,/);
  assert.match(formatErpDateTime("2026-11-19T07:00:00Z"), /^19\/11\/2026,/);
  assert.equal(formatErpDateTime("invalid"), "—");
});

test("iPhone number keypad accepts eight digits without needing a slash key", () => {
  const cases = [
    ["", ""], ["2", "2"], ["22", "22"], ["221", "22/1"],
    ["2211", "22/11"], ["22112", "22/11/2"],
    ["22112026", "22/11/2026"], ["22/11/2026", "22/11/2026"],
    ["22-11-2026", "22/11/2026"], ["2026-11-22", "22/11/2026"],
    ["  22 11 2026  ", "22/11/2026"],
    ["221120260000", "22/11/2026"],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(formatDateEntryInput(raw), expected, raw);
  }
  assert.equal(displayDateToIso(formatDateEntryInput("22112026")), "2026-11-22");
  assert.equal(displayDateToIso(formatDateEntryInput("29022024")), "2024-02-29");
  assert.equal(displayDateToIso(formatDateEntryInput("29022025")), null);
  assert.equal(displayDateToIso(formatDateEntryInput("31022026")), null);
  assert.equal(displayDateToIso(formatDateEntryInput("2211")), null);
});

test("ERP date fields have an in-app calendar and explicit numeric fallback", async () => {
  const { readFileSync } = await import("node:fs");
  const input = readFileSync("src/components/ui/erp-date-input.tsx", "utf8");
  const pr = readFileSync("src/components/erp/pr-form.tsx", "utf8");
  assert.match(input, /formatDateEntryInput\(event\.target\.value\)/);
  assert.match(input, /<PopoverTrigger asChild>/);
  assert.match(input, /aria-label="Open date picker"/);
  assert.match(input, /onClick=\{\(\) => onPicked\(iso\)\}/);
  assert.match(input, /disabled=\{!calendarDateAllowed\(iso, lower, upper\)\}/);
  assert.doesNotMatch(input, /showPicker\(|type="date"|pointer-events-auto/);
  assert.match(pr, /Type DDMMYYYY \(slashes added automatically\) or tap the calendar/);
  assert.match(pr, /value=\{h\.required_by\}/);
  assert.match(pr, /value=\{l\.required_by\}/);
});
