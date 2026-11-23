import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sitePrMilestones, buildSiteEngineerPrTasks } from "../../src/lib/site-engineer-pr-milestones.ts";
import { siteEngineerAttentionTasks } from "../../src/lib/site-engineer-workflow.ts";

const pr={id:"pr1",number:"PR-2026-0008",purpose:"Concrete and pumps",status:"approved",
  project:"City Centre",due:"2026-12-10"};
const po={id:"po1",number:"PO-2026-0004",prId:"pr1",status:"approved"};
const ch={id:"challan1",number:"8519",poId:"po1",status:"registered"};
const grn={id:"grn1",number:"GRN-2026-0001",poId:"po1",status:"draft"};
const records=(extra={})=>({prs:[pr],pos:[po],challans:[],grns:[],...extra});
const labels=["PR requested","PR received for procurement","PO sent for Director approval","Challan entry","Goods received"];
const isDone=(j,i)=>j.stages[i]?.state==="done";
const read=(p)=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");

test("exact five user-requested stages, no invoice or payment",()=>{
 const j=sitePrMilestones(pr,records());
 assert.deepEqual(j.stages.map(s=>s.label),labels);
 assert.deepEqual(j.stages.map(s=>s.key),["request","pr_received","director_approval","challan_entry","goods_received"]);
 assert.deepEqual(j.stages.map(s=>s.state),["done","done","done","current","todo"]);
 assert.equal(j.stage,"Director approved PO — awaiting supplier challan");
 assert.equal(j.stages.some(s=>/Invoice|Payment/.test(s.label)),false);
});

test("PR draft, submitted and received show real milestones only",()=>{
 const draft=sitePrMilestones({...pr,status:"draft"},records({pos:[]}));
 assert.equal(draft.stages[0].state,"current");
 assert.equal(draft.stages[1].state,"todo");
 const submitted=sitePrMilestones({...pr,status:"pending_approval"},records({pos:[]}));
 assert.equal(submitted.stages[0].state,"done");
 assert.equal(submitted.stages[1].state,"current");
 const received=sitePrMilestones(pr,records({pos:[]}));
 assert.deepEqual(received.stages.map(s=>s.state),["done","done","current","todo","todo"]);
 assert.match(received.stage,/PR received for procurement/);
 const awaiting=sitePrMilestones(pr,records({pos:[{...po,status:"pending_approval"}]}));
 assert.equal(awaiting.stages[2].state,"current");
 assert.match(awaiting.stage,/awaiting approval/);
});

test("Challan entry alone never implies goods received or stock posted",()=>{
 const j=sitePrMilestones(pr,records({challans:[ch]}));
 assert.equal(isDone(j,3),true);
 assert.equal(j.stages[4].state,"current");
 assert.equal(j.completed,false);
 assert.equal(j.stages[4].documents.length,0);
 const draft=sitePrMilestones(pr,records({challans:[ch],grns:[grn]}));
 assert.equal(draft.stages[4].state,"current");
 assert.match(draft.stage,/receipt draft/);
 assert.equal(draft.completed,false);
});

test("Multiple challans, GRNs and split POs must all reconcile before a PR is completed",()=>{
 const po2={id:"po2",number:"PO-2026-0005",prId:pr.id,status:"pending_approval"};
 const ch2={id:"challan2",number:"8520",poId:"po1",status:"registered"};
 const posted={...grn,status:"posted"};
 const incomplete=sitePrMilestones(pr,records({
   pos:[{...po,status:"fully_received"},po2],challans:[ch,ch2],grns:[posted],
 }));
 assert.equal(incomplete.completed,false);
 assert.equal(incomplete.stages[2].state,"current");
 assert.equal(incomplete.stages[3].documents.length,2);
 assert.equal(incomplete.stages[4].documents.length,1);
 assert.equal(incomplete.stage.includes("Director"),true);
 const complete=sitePrMilestones(pr,records({
   pos:[{...po,status:"fully_received"},{...po2,status:"short_closed"}],
   challans:[ch,{...ch2,poId:"po2"}],grns:[posted,{id:"grn2",number:"GRN-2",poId:"po2",status:"posted"}],
 }));
 assert.equal(complete.completed,true);
 assert.equal(complete.stages[4].state,"done");
 assert.equal(buildSiteEngineerPrTasks(records({
   pos:[{...po,status:"fully_received"},{...po2,status:"short_closed"}],
   challans:[ch,{...ch2,poId:"po2"}],grns:[posted],
 })).length,0);
 assert.equal(buildSiteEngineerPrTasks(records({
   pos:[{...po,status:"fully_received"}],challans:[ch],grns:[posted],
 }),{includeCompleted:true}).length,1);
});

test("Cancelled and unrelated project documents are excluded from PR milestone evidence",()=>{
 const j=sitePrMilestones(pr,records({
  pos:[po,{id:"other",number:"OTHER",prId:"another-pr",status:"fully_received"}],
  challans:[{...ch,status:"cancelled"},{id:"foreign",number:"X",poId:"other",status:"registered"}],
  grns:[{...grn,status:"cancelled"}],
 }));
 assert.equal(j.stages[3].documents.length,0);
 assert.equal(j.stages[4].documents.length,0);
 assert.equal(j.completed,false);
 const rows=siteEngineerAttentionTasks([],records({pos:[po],challans:[ch]}));
 assert.equal(rows.length,1);
 assert.deepEqual(rows[0].steps.map(s=>s.label),labels);
 assert.equal(rows[0].id,"pr:"+pr.id);
});

test("Site Engineer PR detail tracker fetches only source-linked POs/challans/GRNs",()=>{
 const detail=read("src/components/erp/site-engineer-pr-tracker.tsx");
 const page=read("src/routes/_authenticated/_shell/procurement.purchase-requests.$id.index.tsx");
 const dash=read("src/routes/_authenticated/_shell/dashboard.tsx");
 assert.match(detail,/eq\("purchase_request_id",pr\.id\)/);
 assert.match(detail,/in\("po_id",ids\)/);
 assert.match(detail,/sitePrMilestones\(pr,/);
 assert.match(page,/isSiteEngineerFieldPortal\(me\.data\?\.roles \?\? \[\]\)/);
 assert.match(page,/<SiteEngineerPrTracker/);
 assert.match(dash,/siteEngineerAttentionTasks\(allTasks, chainInput\)/);
 assert.match(dash,/counts: \{/);
});

test("SQL stage triggers notify only original active assigned Site Engineer and preserve existing Director approval",()=>{
 const sql=read("drizzle/migrations/0111_pr_requester_stage_notifications.sql");
 for(const expression of [
   /JOIN public\.purchase_requests pr/,
   /original\.id=pr\.requested_by/,
   /original\.company_id=_company AND original\.is_active/,
   /public\.has_role\(original\.id,'site_engineer'\)/,
   /public\.can_access_project\(original\.id,_project\)/,
   /public\.has_permission\(original\.id,'purchase_request\.view'\)/,
   /notify_document_approvers/,
   /PO sent for Director approval/,
   /Delivery challan recorded/,
   /Goods receipt draft recorded/,
   /Goods received and posted/,
   /notify_pr_engineer_challan_registered/,
   /notify_pr_engineer_grn_stage/,
   /AFTER UPDATE OF status ON public\.purchase_orders/,
 ]) assert.match(sql,expression);
 assert.doesNotMatch(sql,/UPDATE public\.(?:purchase_orders|goods_receipt_notes|vendor_invoices)/);
 assert.doesNotMatch(sql,/GRANT EXECUTE ON FUNCTION public\.notify_pr_original_site_engineer/);
});
