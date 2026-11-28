// Inventory display classification is independent of the internal resale lock.
export type InventoryIdentity={ownership_type?:string|null;legacy_sale_status?:string|null;status:string};
export function inventoryDisplayStatus(unit:InventoryIdentity):string {
 if(unit.ownership_type==="landowner"||unit.ownership_type==="investor")return unit.ownership_type;
 if(unit.legacy_sale_status==="sold")return "sold";
 if(unit.legacy_sale_status==="booked")return "booked";
 if(["registered","possession_pending","possession_completed"].includes(unit.status))return "sold";
 return unit.status;
}
export const inventoryStatusLabels:Record<string,string>={available:"Available",sold:"Sold",booked:"Booked",landowner:"Landowner flat",investor:"Investor flat",hold:"On hold",agreement_pending:"Agreement pending",agreement_done:"Agreement signed",cancelled:"Cancelled"};
export function matchesInventoryStatus(unit:InventoryIdentity,status:string):boolean {
 return !status||inventoryDisplayStatus(unit)===status;
}
export type InventoryLocation={project_id:string;building_id:string;floor_id:string;buildings?:{name:string}|null;floors?:{name:string;floor_number:number}|null};
export function inventoryLocationOptions(rows:readonly InventoryLocation[],project:string,building:string){
 const scoped=rows.filter(u=>!project||u.project_id===project);
 const wings=[...new Map(scoped.map(u=>[u.building_id,{id:u.building_id,name:u.buildings?.name??u.building_id}])).values()].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
 const floors=building?[...new Map(scoped.filter(u=>u.building_id===building).map(u=>[u.floor_id,{id:u.floor_id,name:u.floors?.name??u.floor_id,number:u.floors?.floor_number??0}])).values()].sort((a,b)=>a.number-b.number):[];
 return {wings,floors};
}
