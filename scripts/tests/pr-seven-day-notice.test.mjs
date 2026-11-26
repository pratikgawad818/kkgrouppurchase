import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prNotice, noticeReasonValid } from "../../src/lib/pr-notice.ts";

test("seven calendar days is planned; six or fewer days are late",()=>{
  assert.equal(prNotice("2026-12-03",[],"2026-11-26").late,false);
  assert.equal(prNotice("2026-12-02",[],"2026-11-26").shortfall,1);
  assert.equal(prNotice("2026-11-27",[],"2026-11-26").shortfall,6);
  assert.equal(prNotice("2026-11-26",[],"2026-11-26").days,0);
  assert.equal(prNotice("2026-11-25",[],"2026-11-26").days,-1);
  assert.equal(prNotice("2026-02-30",[],"2026-11-26"),null);
});
test("earliest material deadline controls the request",()=>{
  const result=prNotice("2026-12-10",["","2026-11-27","2026-12-03"],"2026-11-26");
  assert.equal(result.due,"2026-11-27");
  assert.equal(result.days,1);
  assert.equal(result.late,true);
  assert.equal(noticeReasonValid(" urgent "),false);
  assert.equal(noticeReasonValid("Unexpected breakdown at site"),true);
  assert.equal(noticeReasonValid("a".repeat(1001)),false);
});
test("database calculates notice itself and preserves the first submission snapshot",()=>{
  const sql=readFileSync("drizzle/migrations/0123_pr_seven_day_notice.sql","utf8");
  assert.ok(sql.includes("AT TIME ZONE 'Asia/Kolkata'"));
  assert.ok(sql.includes("min(i.required_by)"));
  assert.ok(sql.includes("notice<7"));
  assert.ok(sql.includes("NOT BETWEEN 10 AND 1000"));
  assert.ok(sql.includes("NEW.first_notice_days:=OLD.first_notice_days"));
  assert.ok(sql.includes("IF OLD.first_notice_days IS NULL THEN"));
  assert.ok(sql.includes("short_notice_reason=nullif(btrim(h.short_notice_reason),'')"));
  assert.ok(sql.includes("CREATE TRIGGER zz_pr_capture_notice"));
  assert.ok(sql.includes("IF _submit THEN PERFORM public.pr_transition"));
});
test("register filters and shows planning status separately from approval status",()=>{
  const source=readFileSync("src/routes/_authenticated/_shell/procurement.purchase-requests.index.tsx","utf8");
  assert.equal((source.match(/r\.lt\("first_notice_days", 7\)/g)??[]).length,2);
  assert.equal((source.match(/r\.gte\("first_notice_days", 7\)/g)??[]).length,2);
  assert.ok(source.includes("Classification"));
  assert.ok(source.includes("Not recorded"));
});
