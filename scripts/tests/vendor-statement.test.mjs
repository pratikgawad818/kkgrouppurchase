import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {statementTotals} from "../../src/lib/vendor-statement-model.ts";

const base={vendor:"Supplier A",year:2026,opening:100.25,generatedOn:"2026-11-25",rows:[
 {date:"2026-04-01",doc:"VI-1",kind:"Opening payable",debit:0,credit:300.11,bal:400.36},
 {date:"2026-05-10",doc:"VP-1",kind:"Payment",debit:50.12,credit:0,bal:350.24},
 {date:"2026-06-01",doc:"VI-1",kind:"Historical correction",debit:25.24,credit:0,bal:325},
 {date:"2026-06-02",doc:"VP-1",kind:"Advance adjusted",debit:0,credit:0,bal:325},
]};
test("statement period totals reconcile opening, recorded payments and historical corrections",()=>{
 assert.deepEqual(statementTotals(base),{start:"2026-04-01",end:"2027-03-31",opening:100.25,debit:75.36,credit:300.11,closing:325});
 assert.equal(statementTotals({...base,rows:[]}).closing,100.25);
 assert.equal(statementTotals({...base,opening:-100,rows:[]}).closing,-100);
});
test("bad balance, out of year and invalid amount cannot produce a statement",()=>{
 assert.throws(()=>statementTotals({...base,rows:[{...base.rows[0],bal:0}]}),/reconcile/);
 assert.throws(()=>statementTotals({...base,rows:[{...base.rows[0],date:"2027-04-01"}]}),/out-of-period/);
 assert.throws(()=>statementTotals({...base,opening:NaN}),/Invalid ledger amount/);
 assert.throws(()=>statementTotals({...base,rows:[{...base.rows[0],credit:-1}]}),/Invalid debit/);
 assert.throws(()=>statementTotals({...base,rows:Array(501).fill(base.rows[0])}),/500 transactions/);
});
test("statement renderer reuses local PDF generation and safe group-scope labeling",()=>{
 const pdf=readFileSync("src/lib/vendor-statement-pdf.ts","utf8");
 assert.ok(pdf.includes("statementTotals(data)"));
 assert.ok(pdf.includes("assemblePdf(pages.map"));
 assert.ok(pdf.includes("p=page();header(p)"));
 assert.ok(pdf.includes("not an entity-specific confirmation"));
 assert.ok(pdf.includes("Purchase order commitments are excluded"));
 const page=readFileSync("src/routes/_authenticated/_shell/finance.vendor-ledger.tsx","utf8");
 assert.ok(page.includes("year:fyN,opening,rows:inFy"));
 assert.ok(page.includes("Selected FY closing"));
 assert.ok(page.includes("All-year net balance"));
 assert.ok(page.includes("beginDocumentPreview(name)"));
 assert.ok(page.includes('r==="super_admin"||r==="accounts_manager"||r==="director"'));
 assert.ok(page.includes("q.isSuccess&&!q.isFetching&&vendors.isSuccess&&!vendors.isFetching"));
});
