import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSelectedMaterial } from "../../src/lib/material-usage-tracker.ts";

test("700 bags received / 500 used in two buildings leaves 200 physically in store",()=>{
  const rows=[
    {project_id:"p1",project_name:"Project A",building_id:"b1",building_name:"Tower 1",
      material_id:"cement",material_name:"Cement",unit_code:"BAG",
      issued_quantity:300,returned_quantity:0,net_quantity:300,net_value:90000},
    {project_id:"p1",project_name:"Project A",building_id:"b2",building_name:"Tower 2",
      material_id:"cement",material_name:"Cement",unit_code:"BAG",
      issued_quantity:230,returned_quantity:30,net_quantity:200,net_value:60000},
  ];
  const stock=[{warehouse_id:"s1",quantity_on_hand:200,warehouses:{name:"Main store"}}];
  const s=summarizeSelectedMaterial(rows,stock);
  assert.equal(s.issued,530);
  assert.equal(s.returned,30);
  assert.equal(s.used,500);
  assert.equal(s.onHand,200);
  assert.equal(s.byBuilding.length,2);
  assert.deepEqual(s.byBuilding.map(x=>x.netQuantity),[300,200]);
  assert.equal(s.cost,150000);
});

test("separates available stock company-wide from filtered project usage",()=>{
  const rows=[{project_id:"p2",project_name:"P2",building_id:null,building_name:null,
    material_id:"cement",material_name:"Cement",unit_code:"BAG",
    issued_quantity:5,returned_quantity:1,net_quantity:4,net_value:1200}];
  const stock=[{warehouse_id:"s1",quantity_on_hand:23,warehouses:{name:"Central"}},
    {warehouse_id:"s2",quantity_on_hand:7,warehouses:{name:"Site"}}];
  const s=summarizeSelectedMaterial(rows,stock);
  assert.equal(s.used,4);
  assert.equal(s.onHand,30);
  assert.equal(s.byBuilding[0].building,"General project work");
  assert.notEqual(s.used+s.onHand,700);
});

test("fail closed on incomplete/bad numeric data rather than false zero",()=>{
  const row={project_id:"p",project_name:"P",building_id:null,building_name:null,
    material_id:"m",material_name:"M",unit_code:"BAG",
    issued_quantity:1,returned_quantity:0,net_quantity:NaN,net_value:0};
  assert.throws(()=>summarizeSelectedMaterial([row],[]),/invalid/);
  assert.throws(()=>summarizeSelectedMaterial([],[{warehouse_id:"1",quantity_on_hand:-1,warehouses:null}]),/Invalid/);
});
