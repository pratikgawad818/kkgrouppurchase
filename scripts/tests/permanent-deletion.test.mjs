import test from "node:test";
import assert from "node:assert/strict";
import { validatePermanentDeletion } from "../../src/lib/deletion-policy.ts";
const base = { isSuperAdmin:true,active:true,actorCompanyId:"A",targetCompanyId:"A",kind:"material",actorId:"admin",targetId:"item" };
test("only active Super Admin may permanently delete",()=>{
  assert.throws(()=>validatePermanentDeletion({...base,isSuperAdmin:false}),/Super Admin/);
  assert.throws(()=>validatePermanentDeletion({...base,active:false}),/Super Admin/);
  assert.doesNotThrow(()=>validatePermanentDeletion(base));
});
test("deletion stays within the actor company",()=>{
  assert.throws(()=>validatePermanentDeletion({...base,targetCompanyId:"B"}),/own company/);
  assert.throws(()=>validatePermanentDeletion({...base,actorCompanyId:null,targetCompanyId:null}),/own company/);
});
test("Super Admin cannot delete self or another Super Admin",()=>{
  assert.throws(()=>validatePermanentDeletion({...base,kind:"user",targetId:"admin"}),/cannot be deleted/);
  assert.throws(()=>validatePermanentDeletion({...base,kind:"user",targetIsSuperAdmin:true}),/cannot be deleted/);
  assert.doesNotThrow(()=>validatePermanentDeletion({...base,kind:"user"}));
});
for (const kind of ["purchase_request","rfq","goods_receipt"]) test(`${kind} permanent deletion is draft-only`,()=>{
  assert.doesNotThrow(()=>validatePermanentDeletion({...base,kind,status:"draft"}));
  for(const status of ["pending_approval","approved","sent","closed","cancelled","rejected"]) assert.throws(()=>validatePermanentDeletion({...base,kind,status}),/unused drafts/);
});
test("property units must be available; existing links are additionally checked in the database",()=>{
  assert.doesNotThrow(()=>validatePermanentDeletion({...base,kind:"unit",status:"available"}));
  for(const status of ["hold","booked","registered","cancelled"]) assert.throws(()=>validatePermanentDeletion({...base,kind:"unit",status}),/unused available/);
});
