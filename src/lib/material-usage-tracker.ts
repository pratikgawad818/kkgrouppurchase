/**
 * Project/building issue-minus-return summaries are distinct from physical
 * company store stock. Warehouse transfers and adjustments also change stock.
 * Never imply their difference is necessarily a GRN received balance.
 */
export type MaterialUsage = {
  project_id: string;
  project_name: string;
  building_id: string | null;
  building_name: string | null;
  material_id: string;
  material_name: string;
  unit_code: string;
  issued_quantity: number;
  returned_quantity: number;
  net_quantity: number;
  net_value: number;
};
export type MaterialStock = {
  warehouse_id: string;
  quantity_on_hand: number;
  warehouses: { name: string } | null;
};
export function summarizeSelectedMaterial(rows: readonly MaterialUsage[], stock: readonly MaterialStock[]) {
  let used = 0, issued = 0, returned = 0, materialCost = 0;
  const buildings = new Map<string,{project:string;building:string;netQuantity:number;netCost:number}>();
  for(const r of rows) {
    for(const n of [r.issued_quantity,r.returned_quantity,r.net_quantity,r.net_value])
      if(!Number.isFinite(Number(n)))throw new Error("Material consumption contains invalid quantities or values.");
    issued+=Number(r.issued_quantity);
    returned+=Number(r.returned_quantity);
    used+=Number(r.net_quantity);
    materialCost+=Number(r.net_value);
    const k=r.project_id+"|"+(r.building_id??"general");
    const prior=buildings.get(k);
    buildings.set(k,{project:r.project_name,building:r.building_name??"General project work",
      netQuantity:(prior?.netQuantity??0)+Number(r.net_quantity),
      netCost:(prior?.netCost??0)+Number(r.net_value)});
  }
  let onHand=0;
  const warehouses=stock.map(r=>{
    const quantity=Number(r.quantity_on_hand);
    if(!Number.isFinite(quantity)||quantity<0)throw new Error("Invalid physical store stock balance.");
    onHand+=quantity;
    return {name:r.warehouses?.name??"Store",quantity};
  }).sort((a,b)=>b.quantity-a.quantity);
  const round3=(n:number)=>Math.round(n*1000)/1000;
  return {
    issued:round3(issued),returned:round3(returned),used:round3(used),
    cost:Math.round(materialCost*100)/100,onHand:round3(onHand),warehouses,
    byBuilding:[...buildings.values()].sort((a,b)=>b.netQuantity-a.netQuantity),
  };
}
