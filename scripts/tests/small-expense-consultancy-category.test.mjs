import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync("src/lib/small-expenses.ts", "utf8");
const sql = readFileSync("drizzle/migrations/0082_small_expense_consultancy_marketing.sql", "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const exportsObject = {};
runInNewContext(transpiled, { exports: exportsObject });
const { SMALL_EXPENSE_CATEGORIES, summarizeSmallExpenses } = exportsObject;

describe("Consultancy and Marketing Small Expense category", () => {
  it("is one dedicated visible option, not Other", () => {
    assert.equal(SMALL_EXPENSE_CATEGORIES.consultancy_marketing, "Consultancy and Marketing");
    assert.equal(Object.values(SMALL_EXPENSE_CATEGORIES).filter(
      label => label === "Consultancy and Marketing",
    ).length, 1);
  });

  it("is preserved in category totals, rather than merged into Other", () => {
    const totals = summarizeSmallExpenses([
      { category: "consultancy_marketing", amount: 18500, status: "recorded",
        project_id: null, building_id: null },
      { category: "other", amount: 200, status: "recorded",
        project_id: null, building_id: null },
    ]);
    assert.equal(totals.total, 18700);
    assert.equal(totals.byCategory.get("consultancy_marketing"), 18500);
    assert.equal(totals.byCategory.get("other"), 200);
    assert.equal(totals.count, 2);
  });

  it("updates the database constraint AND both create/edit RPC allowlists", () => {
    assert.match(sql, /ADD CONSTRAINT site_small_expenses_category_check CHECK/);
    const occurrences = sql.match(/'consultancy_marketing'/g) ?? [];
    assert.equal(occurrences.length, 3, "constraint, create RPC, and edit RPC must all allow the value");
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.record_site_small_expense\(/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.edit_site_small_expense\(/);
    assert.match(sql, /role\(auth\.uid\(\),'director'\)/);
    assert.match(sql, /'small_expense\.manage'/);
    assert.match(sql, /'site_small_expense_events'/);
  });
});
