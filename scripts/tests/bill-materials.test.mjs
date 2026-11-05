import test from "node:test";
import assert from "node:assert/strict";
import { filterBillMaterials, materialLineDefaults } from "../../src/lib/bill-materials.ts";

const materials = [
  {id:"cement-id",code:"CEMENT-53",name:"OPC Cement 53 Grade",hsn_sac:"2523",unit_id:"bag-id",category_id:"cat1",units_of_measure:{code:"BAG",name:"Bag"}},
  {id:"steel-id",code:"TMT-12",name:"TMT Steel 12 mm",hsn_sac:"7214",unit_id:"mt-id",category_id:"cat2",units_of_measure:{code:"MT",name:"Metric Tonne"}},
  {id:"concrete-id",code:"RMC-M25",name:"M25 Ready Mix Concrete",hsn_sac:null,unit_id:"cum-id",category_id:"cat3",units_of_measure:{code:"CUM",name:"Cubic Metre"}},
];
test("material picker matches names, codes and HSN case-insensitively",()=>{
  assert.deepEqual(filterBillMaterials(materials,"cement").map(m=>m.id),["cement-id"]);
  assert.deepEqual(filterBillMaterials(materials,"TMT-12").map(m=>m.id),["steel-id"]);
  assert.deepEqual(filterBillMaterials(materials,"7214").map(m=>m.id),["steel-id"]);
  assert.deepEqual(filterBillMaterials(materials,"  ready MIX ").map(m=>m.id),["concrete-id"]);
});
test("selecting master material prefills unit code and HSN while preserving invoice quantity and rate",()=>{
  const original={id:"line-1",description:"TMT",material_id:"",unit:"NOS",hsn_sac:"",quantity:"25.5",rate:"48000",discount:"0",tax_rate:"18"};
  const updated={...original,...materialLineDefaults(materials[1])};
  assert.deepEqual({description:updated.description,material_id:updated.material_id,unit:updated.unit,hsn_sac:updated.hsn_sac},{
    description:"TMT Steel 12 mm",material_id:"steel-id",unit:"MT",hsn_sac:"7214",
  });
  assert.equal(updated.quantity,"25.5");
  assert.equal(updated.rate,"48000");
});
test("results are capped for a compact picker without mutating source",()=>{
  const rows=Array.from({length:35},(_,i)=>({...materials[0],id:String(i),name:"Cement "+i}));
  assert.equal(filterBillMaterials(rows,"cement").length,25);
  assert.equal(rows.length,35);
});
