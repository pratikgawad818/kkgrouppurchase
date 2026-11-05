/** Pure Materials-master helpers for historical vendor bill item entry. */
export type BillMaterialOption = {
  id: string;
  name: string;
  code: string;
  hsn_sac: string | null;
  category_id: string;
  unit_id: string;
  units_of_measure: { code: string; name: string } | null;
};
export type BillMaterialReference = { id: string; name: string; code: string };

export function filterBillMaterials(materials: BillMaterialOption[], query: string): BillMaterialOption[] {
  const q = query.trim().toLocaleLowerCase();
  return materials
    .filter(m => !q || [m.name, m.code, m.hsn_sac ?? ""].some(v => v.toLocaleLowerCase().includes(q)))
    .slice(0, 25);
}

export function materialLineDefaults(material: BillMaterialOption) {
  return {
    material_id: material.id,
    description: material.name,
    unit: material.units_of_measure?.code ?? "",
    hsn_sac: material.hsn_sac ?? "",
  };
}
