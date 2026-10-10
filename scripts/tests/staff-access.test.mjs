import test from "node:test";
import assert from "node:assert/strict";
import { validateStaffUpdate } from "../../src/lib/staff-access.ts";
const input={
  actorId:"admin-A", actorCompanyId:"company-A", targetId:"worker-A",
  targetCompanyId:"company-A", actorIsSuperAdmin:true,
  existingRoles:["site_engineer"],requestedRole:"auditor",requestedActive:true,
};

test("company administrator cannot change staff from another company", () => {
  assert.throws(()=>validateStaffUpdate({...input,targetCompanyId:"company-B"}),/own company/);
  assert.throws(()=>validateStaffUpdate({...input,actorCompanyId:null}),/own company/);
  assert.throws(()=>validateStaffUpdate({...input,targetCompanyId:null}),/own company/);
});
test("super admin cannot be fabricated, removed or deactivated in staff editor", () => {
  assert.throws(()=>validateStaffUpdate({...input,requestedRole:"super_admin"}),/cannot be granted/);
  assert.throws(()=>validateStaffUpdate({...input,existingRoles:["super_admin"],actorIsSuperAdmin:false,requestedRole:null}),/Only a Super Admin/);
  assert.throws(()=>validateStaffUpdate({...input,existingRoles:["super_admin"],requestedRole:"auditor"}),/cannot be replaced/);
  assert.throws(()=>validateStaffUpdate({...input,existingRoles:["super_admin"],requestedRole:null,requestedActive:false}),/cannot be deactivated/);
  assert.deepEqual(validateStaffUpdate({...input,existingRoles:["super_admin"],requestedRole:null}),{
    preserveSuperAdmin:true,changeRoles:false
  });
});
test("editing personal details cannot silently remove the current admin role", () => {
  assert.throws(()=>validateStaffUpdate({...input,actorId:"worker-A",requestedRole:null}),/cannot change your own role/);
  assert.throws(()=>validateStaffUpdate({...input,actorId:"worker-A",requestedRole:"auditor"}),/cannot change your own role/);
  assert.deepEqual(validateStaffUpdate({...input,actorId:"worker-A",requestedRole:"site_engineer"}),{
    preserveSuperAdmin:false,changeRoles:false
  });
  assert.throws(()=>validateStaffUpdate({...input,actorId:"worker-A",requestedRole:"site_engineer",requestedActive:false}),/deactivate your own/);
});
test("normal manager may change or remove roles only for a company colleague", () => {
  assert.deepEqual(validateStaffUpdate({...input,actorIsSuperAdmin:false}),{
    preserveSuperAdmin:false,changeRoles:true
  });
  assert.deepEqual(validateStaffUpdate({...input,requestedRole:"site_engineer"}),{
    preserveSuperAdmin:false,changeRoles:false
  });
  assert.deepEqual(validateStaffUpdate({...input,requestedRole:null}),{
    preserveSuperAdmin:false,changeRoles:true
  });
});
