import test from "node:test";
import assert from "node:assert/strict";
import {
  isoDateToDisplay, displayDateToIso, formatErpDate, formatErpDateTime,
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
