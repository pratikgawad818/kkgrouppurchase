import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { poBuyerIdentity } from "../../src/lib/po-buyer-identity.ts";

const read=(path)=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const sql=read("drizzle/migrations/0109_legal_entities_project_buyer_snapshots.sql");
const manager=read("src/components/erp/legal-entity-manager.tsx");
const settings=read("src/routes/_authenticated/_shell/settings.company.tsx");
const pdf=read("src/lib/po-pdf.ts");
const printable=read("src/components/erp/print-po.tsx");
const oldCompany={
 name:"KK Group Builders",legal_name:"K.K.CONSTRUCTION",
 gstin:"27AALFK3094R1ZG",registered_address:"Head Office, Palghar",
 office_address:null,pan:"AALFK3094R",phone:null,email:null,
};
test("historical PO retains original tenant buyer; fresh PO uses frozen legal entity",()=>{
 assert.deepEqual(poBuyerIdentity({companies:oldCompany}),oldCompany);
 const original={buyer_legal_entity_id:"kanesa-id",buyer_legal_name:"Kanesa Edifice Private Limited",
  buyer_gstin:"27AAAAA0000A1Z5",buyer_pan:"AAAAA0000A",
  buyer_registered_address:"Kanesa registered address",buyer_phone:null,buyer_email:null,
  companies:oldCompany};
 const buyer=poBuyerIdentity(original);
 assert.equal(buyer?.legal_name,"Kanesa Edifice Private Limited");
 assert.equal(buyer?.gstin,"27AAAAA0000A1Z5");
 assert.equal(buyer?.registered_address,"Kanesa registered address");
 assert.equal(buyer?.name,"Kanesa Edifice Private Limited");
 assert.notEqual(buyer?.gstin,original.companies.gstin);
 assert.equal(poBuyerIdentity({buyer_legal_entity_id:null,companies:oldCompany})?.gstin,oldCompany.gstin);
});
test("PDF, print and signatures use PO buyer snapshot, not current legal-entity master",()=>{
 assert.match(pdf,/const company = poBuyerIdentity\(po\)/);
 assert.match(pdf,/const buyer = poBuyerIdentity\(order\)/);
 assert.match(pdf,/poBuyerIdentity\(po\)\?\.legal_name/);
 assert.match(printable,/const company = poBuyerIdentity\(po\)/);
 assert.doesNotMatch(pdf,/const company = po\.companies/);
 assert.doesNotMatch(printable,/const company = po\.companies/);
});
test("mapping is explicit, not guessed; missing GST details block new PO insert",()=>{
 assert.match(sql,/p\.code='CC' AND p\.name='City Centre'/);
 assert.match(sql,/e\.code='KANESA'/);
 assert.match(sql,/p\.code='KKP' AND p\.name='KK Park'/);
 assert.match(sql,/p\.code='CP-2' AND p\.name='Crescent Point-II'/);
 assert.match(sql,/e\.code='KKCON'/);
 assert.match(sql,/SELECT c\.id,'KKINFRA','KK Infra'/);
 assert.match(sql,/Navali does not exist yet/);
 assert.doesNotMatch(sql,/p\.name='Central Hub'[^\n]*SET legal_entity_id/);
 assert.match(sql,/Complete legal name, GSTIN and registered address/);
 assert.match(sql,/NEW\.buyer_legal_name:=entity\.legal_name/);
 assert.match(sql,/NEW\.buyer_gstin:=entity\.gstin/);
 assert.match(sql,/PO buyer identity is immutable/);
});
test("legal entity master and mapping restricted to Super Admin, with company isolation",()=>{
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/actor_in_company\(company_id\)/);
 assert.match(sql,/public\.has_role\(auth\.uid\(\),'super_admin'\)/);
 assert.match(sql,/Only Super Admin can change a project legal entity/);
 assert.match(sql,/company_id REFERENCES|company_id uuid NOT NULL REFERENCES/);
 assert.match(sql,/legal_entities_one_registration_per_tenant/);
 assert.match(settings,/<LegalEntityManager companyId=\{query\.data\.id\}/);
 assert.match(manager,/legal_entity_id/);
 assert.match(manager,/New POs for those projects cannot be created/);
 assert.match(manager,/Navali → KK Infra/);
});
