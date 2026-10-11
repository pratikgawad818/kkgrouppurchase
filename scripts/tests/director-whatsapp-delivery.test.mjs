import test from "node:test";
import assert from "node:assert/strict";
import { directorWaConfig, templatePayload, deliverDirectorTemplate } from "../../src/lib/director-whatsapp-delivery.ts";
import { approvalReference, parseApprovalReference } from "../../src/lib/director-whatsapp-reference.ts";

const ID="30000000-0000-4000-8000-000000000001";
const request={outbox_id:ID,lease_id:ID,phone:"919876543210",kind:"purchase_order",number:"PO-2026-01",
  document_id:ID,notice_stage:"initial"};
const readyEnv={
  KK_DIRECTOR_WA_SEND_ENABLED:"true",KK_DIRECTOR_WA_COEXISTENCE_VERIFIED:"true",
  KK_DIRECTOR_WA_CLOUD_PHONE_ID:"123456789012345",KK_DIRECTOR_WA_APPROVED_PHONE_ID:"123456789012345",
  KK_DIRECTOR_WA_WABA_ID:"123456789012346",KK_DIRECTOR_WA_APPROVED_WABA_ID:"123456789012346",
  KK_DIRECTOR_WA_ACCESS_TOKEN:"test-only-xxxxxxxxxxxxxxxxxxxxxxx",KK_DIRECTOR_WA_APPROVAL_ORIGIN:"https://erp.example.com",
  KK_DIRECTOR_WA_TEMPLATE_NAME:"kk_director_approval_v1",KK_DIRECTOR_WA_TEMPLATE_APPROVED:"true",
};
test("sending is disabled by default and fails closed for unapproved sender",async()=>{
  assert.equal(directorWaConfig({}).ready,false);
  assert.equal(directorWaConfig({...readyEnv,KK_DIRECTOR_WA_COEXISTENCE_VERIFIED:"false"}).ready,false);
  assert.equal(directorWaConfig({...readyEnv,KK_DIRECTOR_WA_APPROVED_PHONE_ID:"some-other-id"}).ready,false);
  assert.equal(directorWaConfig({...readyEnv,KK_DIRECTOR_WA_APPROVAL_ORIGIN:"http://bad.example"}).ready,false);
  assert.equal(directorWaConfig({...readyEnv,KK_DIRECTOR_WA_TEMPLATE_APPROVED:"false"}).ready,false);
  let called=false;
  await assert.rejects(deliverDirectorTemplate(directorWaConfig({}),request,async()=>{called=true;}),/disabled/);
  assert.equal(called,false);
});
test("Meta body parameters and verified URL button never contain approval tokens",async()=>{
  const cfg=directorWaConfig(readyEnv);
  assert.equal(cfg.ready,true);
  const payload=templatePayload(cfg,request);
  assert.equal(payload.template.components[0].parameters[0].text,"Purchase Order");
  assert.equal(payload.template.components[0].parameters[1].text,"PO-2026-01");
  const ref=payload.template.components[1].parameters[0].text;
  assert.equal(ref,"po_"+ID);
  assert.deepEqual(parseApprovalReference(ref),{kind:"purchase_order",id:ID});
  assert.equal(approvalReference("vendor_payment",ID),"pay_"+ID);
  assert.equal(parseApprovalReference("pay_"+ID)?.kind,"vendor_payment");
  assert.equal(parseApprovalReference("pay_%2F%2E"),null);
  let sent;
  const response=await deliverDirectorTemplate(cfg,request,async(url,opts)=>{
    sent={url,opts,body:JSON.parse(opts.body)};
    return new Response(JSON.stringify({messages:[{id:"wamid.test.123"}]}),{status:200});
  });
  assert.equal(response.status,"accepted");
  assert.equal(response.messageId,"wamid.test.123");
  assert.equal(sent.body.to,"919876543210");
  assert.equal(sent.url,"https://graph.facebook.com/v25.0/123456789012345/messages");
});
test("unknown API outcomes are NOT retried, only definitive 4xx are rejected",async()=>{
  const cfg=directorWaConfig(readyEnv);
  let count=0;
  const failure=await deliverDirectorTemplate(cfg,request,async()=>{count++;throw Error("network timeout");});
  assert.equal(failure.status,"unknown");
  assert.equal(count,1);
  assert.equal((await deliverDirectorTemplate(cfg,request,async()=>new Response("rate limited",{status:429}))).status,"unknown");
  assert.equal((await deliverDirectorTemplate(cfg,request,async()=>new Response("bad request",{status:400}))).status,"rejected");
  assert.equal((await deliverDirectorTemplate(cfg,request,async()=>new Response("{}",{status:200}))).status,"unknown");
});
