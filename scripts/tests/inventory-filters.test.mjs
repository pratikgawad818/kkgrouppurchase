import test from "node:test";
import assert from "node:assert/strict";
import { inventoryDisplayStatus, matchesInventoryStatus, inventoryLocationOptions } from "../../src/lib/inventory-filters.ts";
test("inventory classification prevents historical and ownership locks appearing as Hold",()=>{
 const sold={status:"hold",ownership_type:"builder",legacy_sale_status:"sold"};
 const land={status:"hold",ownership_type:"landowner"};
 const investor={status:"hold",ownership_type:"investor"};
 assert.equal(inventoryDisplayStatus(sold),"sold");
 assert.equal(inventoryDisplayStatus(land),"landowner");
 assert.equal(inventoryDisplayStatus(investor),"investor");
 assert.equal(inventoryDisplayStatus({status:"registered"}),"sold");
 assert.equal(matchesInventoryStatus(sold,"hold"),false);
 assert.equal(matchesInventoryStatus(land,"available"),false);
 assert.equal(matchesInventoryStatus(sold,"sold"),true);
 assert.equal(matchesInventoryStatus({status:"hold"},"hold"),true);
});
test("wing and floor selectors cascade by project and sort numerically",()=>{
 const rows=[{project_id:"p",building_id:"a",floor_id:"a10",buildings:{name:"Wing A"},floors:{name:"Floor 10",floor_number:10}},{project_id:"p",building_id:"a",floor_id:"a2",buildings:{name:"Wing A"},floors:{name:"Floor 2",floor_number:2}},{project_id:"p",building_id:"b",floor_id:"b1",buildings:{name:"Wing B"},floors:{name:"Floor 1",floor_number:1}},{project_id:"q",building_id:"c",floor_id:"c1",buildings:{name:"Wing C"},floors:{name:"Floor 1",floor_number:1}}];
 assert.deepEqual(inventoryLocationOptions(rows,"p","a").wings.map(x=>x.id),["a","b"]);
 assert.deepEqual(inventoryLocationOptions(rows,"p","a").floors.map(x=>x.id),["a2","a10"]);
 assert.deepEqual(inventoryLocationOptions(rows,"p","").floors,[]);
 assert.deepEqual(inventoryLocationOptions(rows,"q","a").floors,[]);
});

import { summarizeFlatInventory } from "../../src/lib/sales-period-dashboard.ts";
test("wing overview reconciles real inventory classifications and never includes third-party flats as available",()=>{
 const rows=[{id:"1",project_id:"p",building_id:"a",buildings:{name:"Wing A"},status:"available"},{id:"2",project_id:"p",building_id:"a",buildings:{name:"Wing A"},status:"hold",legacy_sale_status:"sold",ownership_type:"builder"},{id:"3",project_id:"p",building_id:"b",buildings:{name:"Wing B"},status:"hold",ownership_type:"landowner"}];
 const result=summarizeFlatInventory(["p"],rows);
 assert.equal(result.total.available,1);assert.equal(result.total.sold,1);assert.equal(result.total.thirdParty,1);
 assert.equal(result.wings.length,2);assert.equal(result.wings[0].stock.total,2);assert.equal(result.wings[1].stock.unsold,0);
 assert.throws(()=>summarizeFlatInventory(["other"],rows),/unassigned/);
});
