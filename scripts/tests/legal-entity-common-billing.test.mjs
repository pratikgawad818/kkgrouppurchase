import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { poBuyerIdentity } from "../../src/lib/po-buyer-identity.ts";

const source = p => readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const migration=source("drizzle/migrations/0110_verified_entity_gstin_shared_billing.sql");
const manager=source("src/components/erp/legal-entity-manager.tsx");
const poPdf=source("src/lib/po-pdf.ts");
const printPo=source("src/components/erp/print-po.tsx");

function checksumValid(gstin) {
 const alphabet="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
 let factor=2, sum=0;
 for (const c of gstin.slice(0,-1).split("").reverse()) {
  const value=alphabet.indexOf(c)*factor;
  sum+=Math.floor(value/36)+(value%36);
  factor=factor===2?1:2;
 }
 return alphabet[(36-sum%36)%36]===gstin.at(-1);
}

test("user-supplied Kanesa and KK Infra GSTINs have valid check digits and PAN positions",()=>{
 assert.ok(checksumValid("27AAJCK7799N1ZC"));
 assert.ok(checksumValid("27ABFFK4382H1Z4"));
 assert.match(migration,/27AAJCK7799N1ZC/);
 assert.match(migration,/27ABFFK4382H1Z4/);
 assert.match(migration,/AAJCK7799N/);
 assert.match(migration,/ABFFK4382H/);
});

test("common bill-to is distinct from each legal entity registered office",()=>{
 assert.match(migration,/ADD COLUMN IF NOT EXISTS billing_address text/);
 assert.match(migration,/ADD COLUMN IF NOT EXISTS buyer_billing_address text/);
 assert.match(migration,/billing_address=c.registered_address/);
 assert.match(migration,/NEW\.buyer_billing_address:=entity\.billing_address/);
 assert.match(migration,/Complete legal name, GSTIN and billing address/);
 assert.match(migration,/NEW\.buyer_registered_address:=entity\.registered_address/);
 assert.match(migration,/NEW\.buyer_registered_address,NEW\.buyer_billing_address/);
 assert.match(migration,/OLD\.buyer_registered_address,OLD\.buyer_billing_address/);
 assert.match(manager,/legal-entity-billing-address/);
 assert.match(manager,/registered_address,billing_address,office_address/);
 assert.match(manager,/Bill to:/);
 assert.match(manager,/Registered:/);
});

test("PO bill-to is frozen and printed for new orders; old orders remain readable",()=>{
 const company={name:"KK GROUP",legal_name:"K.K.CONSTRUCTION",gstin:"27AALFK3094R1ZG",
   pan:null,registered_address:"Head Office, Palghar",office_address:null,phone:null,email:null};
 const historic=poBuyerIdentity({companies:company});
 assert.equal(historic?.registered_address,"Head Office, Palghar");
 const newPo=poBuyerIdentity({companies:company,buyer_legal_entity_id:"kanesa",
   buyer_legal_name:"KANESA EDIFICE PRIVATE LIMITED",buyer_gstin:"27AAJCK7799N1ZC",
   buyer_pan:"AAJCK7799N",buyer_registered_address:null,
   buyer_billing_address:"Head Office, Kacheri Road, Palghar",buyer_phone:null,buyer_email:null});
 assert.equal(newPo?.legal_name,"KANESA EDIFICE PRIVATE LIMITED");
 assert.equal(newPo?.gstin,"27AAJCK7799N1ZC");
 assert.equal(newPo?.billing_address,"Head Office, Kacheri Road, Palghar");
 assert.equal(newPo?.registered_address,null);
 assert.match(poPdf,/company\?\.billing_address \|\| company\?\.registered_address/);
 assert.match(printPo,/company\?\.billing_address \|\| company\?\.registered_address/);
});

test("existing PO, invoice and stock records are never modified in registration migration",()=>{
 assert.doesNotMatch(migration,/UPDATE public\.(?:purchase_orders|purchase_requests|vendor_invoices|goods_receipt_notes|inventory_transactions|journal_entries)/);
 assert.doesNotMatch(migration,/DELETE FROM public\./);
});
