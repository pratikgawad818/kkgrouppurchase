import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync("src/lib/small-expenses.ts", "utf8");
const sql = readFileSync("drizzle/migrations/0083_separate_consultancy_marketing_expenses.sql", "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const exportsObject = {};
runInNewContext(transpiled, { exports: exportsObject });
const { SMALL_EXPENSE_CATEGORIES, summarizeSmallExpenses } = exportsObject;

describe("Separate Consultancy and Marketing Small Expense categories", () => {
  it("provides two independent category options, not a combined option", () => {
    assert.equal(SMALL_EXPENSE_CATEGORIES.consultancy, "Consultancy");
    assert.equal(SMALL_EXPENSE_CATEGORIES.marketing, "Marketing");
    assert.equal("consultancy_marketing" in SMALL_EXPENSE_CATEGORIES, false);
    assert.equal(Object.values(SMALL_EXPENSE_CATEGORIES).filter(
      label => label === "Consultancy" || label === "Marketing",
    ).length, 2);
  });

  it("totals consultancy and marketing separately from each other and Other", () => {
    const totals = summarizeSmallExpenses([
      { category: "consultancy", amount: 18500, status: "recorded",
        project_id: null, building_id: null },
      { category: "marketing", amount: 4200, status: "recorded",
        project_id: null, building_id: null },
      { category: "other", amount: 200, status: "recorded",
        project_id: null, building_id: null },
    ]);
    assert.equal(totals.total, 22900);
    assert.equal(totals.byCategory.get("consultancy"), 18500);
    assert.equal(totals.byCategory.get("marketing"), 4200);
    assert.equal(totals.byCategory.get("other"), 200);
    assert.equal(totals.count, 3);
  });

  it("updates the database constraint AND both create/edit RPC allowlists", () => {
    assert.match(sql, /ADD CONSTRAINT site_small_expenses_category_check CHECK/);
    const separateOptions = sql.match(/'consultancy','marketing'/g) ?? [];
    assert.equal(separateOptions.length, 3, "constraint, create RPC, and edit RPC must allow both values");
    assert.match(sql, /WHERE category='consultancy_marketing'/,
      "legacy entries should block migration rather than being silently reclassified");
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.record_site_small_expense\(/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.edit_site_small_expense\(/);
    assert.match(sql, /role\(auth\.uid\(\),'director'\)/);
    assert.match(sql, /'small_expense\.manage'/);
    assert.match(sql, /INSERT INTO public\.site_small_expense_events/);
  });
});
