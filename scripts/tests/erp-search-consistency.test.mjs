import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchesRecordSearch, normalizedSearchText, visibleSearchPage, prepareRecordSearch }
  from "../../src/lib/erp-search.ts";

test("one search matches mixed-case names, document numbers, punctuation and copy/pasted spaces",()=>{
  const values=["Tanuj Shah", "City Centre", "PR-2026-0118", "M40 (JKECB2)"];
  for (const term of ["tanuj","SHAH","city centre","PR-2026-0118",
    "PR20260118","M40","(JKECB2)","city tanuj","M40 JKECB2","  pr 2026 0118  "]) {
    assert.equal(matchesRecordSearch(values,term),true,term);
  }
  assert.equal(matchesRecordSearch(values,"City Mumbai"),false);
  assert.equal(matchesRecordSearch(values,"nonexisting"),false);
});
test("search remains Unicode-aware and resilient to wildcard and comma input",()=>{
  assert.equal(matchesRecordSearch(["श्री कृष्ण मंदिर"],"कृष्ण"),true);
  assert.equal(matchesRecordSearch(["Ravi, Traders"],"ravi traders"),true);
  assert.equal(matchesRecordSearch(["Shree  Cement"],"SHREE CEMENT"),true);
  assert.equal(matchesRecordSearch(["abc"],""),true);
  assert.equal(matchesRecordSearch([null,undefined],"po"),false);
  assert.equal(matchesRecordSearch(["PO-100"],"po%100"),true);
  assert.equal(normalizedSearchText("   CNG (SITE) — PALGHAR "), "cng site palghar");
});
test("search pagination never silently renders an empty later page",()=>{
  assert.equal(visibleSearchPage(6,2,25),0);
  assert.equal(visibleSearchPage(6,51,25),2);
  assert.equal(visibleSearchPage(-1,100,25),0);
  assert.equal(visibleSearchPage(0,0,25),0);
  assert.equal(visibleSearchPage(Number.NaN,20,25),0);
  assert.equal(visibleSearchPage(2,100,0),0);
});
test("large procurement and stock search screens do not silently truncate to 2,000 rows",()=>{
  for(const file of [
    "src/routes/_authenticated/_shell/procurement.purchase-orders.index.tsx",
    "src/routes/_authenticated/_shell/inventory.goods-received.index.tsx",
    "src/routes/_authenticated/_shell/inventory.delivery-challans.index.tsx",
    "src/routes/_authenticated/_shell/inventory.material-issues.index.tsx",
    "src/routes/_authenticated/_shell/procurement.follow-ups.tsx",
    "src/routes/_authenticated/_shell/procurement.rfqs.index.tsx",
  ]){
    const source=readFileSync(file,"utf8");
    assert.match(source,/loadCompleteRows/,file);
    assert.doesNotMatch(source,/\.limit\(2000\)/,file);
  }
});
test("PR lookup searches the complete accessible scoped set before pagination",()=>{
  const source=readFileSync("src/routes/_authenticated/_shell/procurement.purchase-requests.index.tsx","utf8");
  assert.match(source,/pr-search-catalog/);
  assert.match(source,/purchase_request_items\(items\(name,code\)\)/);
  assert.match(source,/matchesRecordSearch/);
  assert.match(source,/matched\.slice\(page\*PAGE/);
  assert.doesNotMatch(source,/\.limit\(200\)/);
});
test("RFQ, invoice, PO and stock search match displayed linked fields",()=>{
  const files=[
    "src/routes/_authenticated/_shell/procurement.rfqs.index.tsx",
    "src/routes/_authenticated/_shell/finance.vendor-invoices.index.tsx",
    "src/routes/_authenticated/_shell/procurement.purchase-orders.index.tsx",
    "src/lib/stock-ledger-filter.ts",
    "src/lib/stock-register.ts",
  ];
  for(const file of files)assert.match(readFileSync(file,"utf8"),/matchesRecordSearch/,file);
  assert.match(readFileSync(files[0],"utf8"),/purchase_requests\?\.pr_number/);
  assert.match(readFileSync(files[1],"utf8"),/projects\?\.name/);
});
test("ERP page finder includes acronyms but keeps authorized navigation filtering",()=>{
  const frame=readFileSync("src/components/erp/workspace-frame.tsx","utf8");
  assert.match(frame,/PAGE_SEARCH_ALIASES/);
  for(const alias of ["GRN","RFQ","PO","PR"]) assert.match(frame,new RegExp(alias));
  assert.match(frame,/groups\.map\(\(group\)/);
  assert.match(frame,/groups\.find/);
});


test("Sales search supports flat numbers, buyers, booking numbers and payment references",()=>{
  const source=readFileSync("src/components/erp/sales-register.tsx","utf8");
  assert.match(source,/unit_id\.in\./);
  assert.match(source,/sale_id\.in\./);
  assert.match(source,/Too many matching flats/);
  assert.match(source,/Reference, buyer or booking/);
});

test("audit search uses counted server pagination rather than only 300 newest events",()=>{
  const source=readFileSync("src/routes/_authenticated/_shell/audit.tsx","utf8");
  assert.match(source,/count:"exact"/);
  assert.match(source,/\.range\(page\*PAGE,\(page\+1\)\*PAGE-1\)/);
  assert.doesNotMatch(source,/\.limit\(300\)/);
  assert.match(source,/<Pager page=\{page\}/);
});

test("flat inventory and historical usage are never silently restricted to 1,000 or 2,000 rows",()=>{
  const flat=readFileSync("src/routes/_authenticated/_shell/units.tsx","utf8");
  const history=readFileSync("src/routes/_authenticated/_shell/inventory.material-consumption.tsx","utf8");
  assert.match(flat,/loadCompleteRows/);
  assert.match(flat,/matchesRecordSearch/);
  assert.match(history,/loadCompleteRows/);
  assert.doesNotMatch(history,/\.limit\(2000\)/);
});

test("prepared search matches original semantics for mixed fields and compact references",()=>{
  const old=(values,search)=>{
    const terms=normalizedSearchText(search).slice(0,150).split(" ").filter(Boolean);
    const normalized=values.map(normalizedSearchText);
    const all=normalized.join(" "),compact=normalized.map(s=>s.replace(/\s/g,"")).join(" ");
    return terms.every(term=>all.includes(term)||compact.includes(term));
  };
  const rows=[["PO-2026-0004","City Centre","Shree Cement"],["श्री कृष्ण","UPI-10001",null],["Ravi, Traders","00012"],[],["A","B"],["A B","C"]];
  for(const query of ["","po20260004","city cement","upi10001 कृष्ण","RAVI TRADERS","00012","ab","a b","not found","po%2026","a".repeat(151)]){
    const prepared=prepareRecordSearch(query);
    for(const row of rows)assert.equal(matchesRecordSearch(row,prepared),old(row,query),query);
  }
});
test("high-use registers reuse prepared terms and financial exports wait for current search",()=>{
  for(const file of ["finance.vendor-invoices.index.tsx","finance.payments.index.tsx","finance.payables.tsx","procurement.purchase-orders.index.tsx","procurement.rfqs.index.tsx","procurement.purchase-requests.index.tsx","inventory.goods-received.index.tsx"]){
    const source=readFileSync("src/routes/_authenticated/_shell/"+file,"utf8");
    assert.match(source,/const preparedSearch = prepareRecordSearch\(/,file);
    assert.match(source,/\],\s*preparedSearch\)/,file);
    if(file.startsWith("finance."))assert.match(source,/search===deferredSearch/,file);
  }
  const grn=readFileSync("src/routes/_authenticated/_shell/inventory.goods-received.index.tsx","utf8");
  assert.doesNotMatch(grn,/\.limit\(500\)/);
  assert.match(grn,/scope\.assignedProjectIds/);
  assert.match(grn,/loadCompleteRows/);
});
