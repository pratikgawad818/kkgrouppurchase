import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync("src/routes/_authenticated/_shell/finance.small-expenses.tsx","utf8");
test("repeat entry only follows a successful new manager expense and uses a fresh entry key",()=>{
 assert.ok(ui.includes("result.continueEntry&&!result.corrected&&!result.billFailures.length&&canEdit"));
 assert.ok(ui.includes("setOpen(keepOpen);setForm(fresh);setFormBaseline(JSON.stringify(fresh));setEntryKey(crypto.randomUUID())"));
 assert.ok(ui.includes("canEdit&&!editingId&&<Button"));
 assert.ok(ui.includes("Save & add another"));
 assert.ok(ui.includes("setNewBills([]);setRemovedBillPaths([])"));
});
test("expense entry warns before dismissal or refresh and blocks edits during saving",()=>{
 assert.ok(ui.includes("JSON.stringify(form)!==formBaseline"));
 assert.ok(ui.includes('window.confirm("Discard the unsaved expense changes?")'));
 assert.ok(ui.includes('window.addEventListener("beforeunload",warn)'));
 assert.ok(ui.includes("<fieldset disabled={save.isPending}"));
 assert.ok(ui.includes("duplicateCandidates.length&&!window.confirm"));
 assert.ok(ui.includes("parseSmallExpenseAmount(form.amount)"));
 assert.ok(ui.includes('untypedDb.rpc("record_site_small_expense_detailed",fields)'));
 assert.ok(ui.includes('untypedDb.rpc("edit_site_small_expense"'));
});
test("new filters respect the original vendor filter, complete totals, and own-only site access",()=>{
 assert.ok(ui.includes("matchesSmallExpenseVendor(x.paid_to,vendorFilter)"));
 assert.ok(ui.includes("(!methodFilter||x.payment_method===methodFilter)"));
 assert.ok(ui.includes("matchesRecordSearch([x.description,x.receipt_reference,x.other_category_detail],detailSearch)"));
 assert.ok(ui.includes('setMethodFilter("");setDetailSearch("")'));
 assert.ok(ui.includes("const total=summarizeSmallExpenses(rows)"));
 assert.ok(ui.includes('if (isSiteEngineer) query=query.eq("created_by",me.data!.profile.id)'));
 assert.ok(ui.includes("const canDelete=canEdit && isSuperAdmin"));
});
