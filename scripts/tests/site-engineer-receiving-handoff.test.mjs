import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isSiteEngineerFieldPortal,
  siteEngineerAttentionTasks,
} from "../../src/lib/site-engineer-workflow.ts";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const dash = read("src/routes/_authenticated/_shell/dashboard.tsx");
const workspace = read("src/components/erp/daily-workspace.tsx");
const access = read("src/lib/page-access.ts");
const baseSteps = ["request","rfq","order","delivery","invoice","payment"]
  .map((key) => ({ key, label:key, documents:[], state:"todo" }));

function task(group="purchasing", key="order") {
  return {
    id:"po-1",number:"PR-2026-0008",description:"M40 concrete",project:"City Centre",
    kind:key,group,stage:"Goods receipt being verified",action:"View GRN",
    href:"/inventory/goods-received/qa-grn",due:null,
    steps:baseSteps.map(step=>({...step})),
  };
}

test("Site Engineer is the field role; Director, Super Admin and Finance are not field-only",()=>{
  assert.equal(isSiteEngineerFieldPortal(["site_engineer"]),true);
  assert.equal(isSiteEngineerFieldPortal(["site_engineer","project_manager"]),true);
  for(const r of ["director","super_admin","accounts_manager","accountant","purchase_manager"]) {
    assert.equal(isSiteEngineerFieldPortal(["site_engineer",r]),false,r);
  }
  assert.equal(isSiteEngineerFieldPortal(["accounts_manager"]),false);
});

test("Site Engineer sees PR → RFQ → PO → Goods Received only",()=>{
  const pending = task();
  const rows = siteEngineerAttentionTasks([pending]);
  assert.deepEqual(rows[0].steps.map(step=>step.key),
    ["request","rfq","order","delivery"]);
  assert.equal(rows[0].group,"purchasing");
  assert.equal(rows[0].action,"View GRN");
  assert.equal(rows[0].href,"/inventory/goods-received/qa-grn");
  assert.equal(pending.steps.length,6,"projection must not mutate manager's full timeline");
});

test("Fully received PO waiting for invoice is no longer a Site Engineer pending task",()=>{
  const completed={...task("payments","invoice"),
    stage:"Delivery complete — waiting for invoice",action:"View order"};
  const awaitingPayment={...task("payments","payment"),
    id:"payment-1",stage:"Payment approved — record transaction"};
  const stillReceiving=task();
  assert.deepEqual(
    siteEngineerAttentionTasks([completed,awaitingPayment,stillReceiving]).map(row=>row.id),
    ["po-1"]);
  assert.equal(stillReceiving.steps.length,6);
});

test("Site Engineer dashboard does not query finance or show financial workflow and task counts",()=>{
  assert.match(dash,/const canInvoices = !isSiteEngineerPortal && can\("\/finance\/vendor-invoices"\)/);
  assert.match(dash,/const canPayments = !isSiteEngineerPortal && can\("\/finance\/payments"\)/);
  assert.match(dash,/const canPayables = !isSiteEngineerPortal && can\("\/finance\/payables"\)/);
  assert.match(dash,/const tasks = isSiteEngineerPortal\s*\? siteEngineerAttentionTasks\(allTasks, chainInput\)/);
  assert.match(dash,/purchasing: tasks\.filter\(t => t\.group === "purchasing"\)\.length/);
  assert.match(dash,/isSiteEngineerPortal=\{isSiteEngineerPortal\}/);
  assert.match(workspace,/From request to goods received/);
  assert.match(workspace,/isSiteEngineerPortal \? "Procurement and site receiving workflow"/);
});

test("Finance pages remain individually permission guarded; only own small expenses are engineer accessible",()=>{
  assert.match(access,/vendor_invoice\.view/);
  assert.match(access,/payment\.view/);
  assert.match(access,/small_expense\.create/);
  assert.doesNotMatch(read("src/lib/site-engineer-workflow.ts"),/GRANT|UPDATE public|DELETE FROM public/);
});
