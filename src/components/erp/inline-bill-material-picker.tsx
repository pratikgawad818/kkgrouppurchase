import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { requireSingleCompanyId } from "@/lib/company-scope";
import { autoCode } from "@/lib/format";
import { errMsg } from "@/lib/format";
import { cn } from "@/lib/utils";
import { filterBillMaterials, type BillMaterialOption, type BillMaterialReference } from "@/lib/bill-materials";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

export function InlineBillMaterialPicker({
  itemId, value, materialId, disabled, materials, loading, error, canCreate,
  categories, units, onType, onPick,
}: {
  itemId: string;
  value: string;
  materialId: string;
  disabled: boolean;
  materials: BillMaterialOption[];
  loading: boolean;
  error: string | null;
  canCreate: boolean;
  categories: BillMaterialReference[];
  units: BillMaterialReference[];
  onType: (text: string) => void;
  onPick: (material: BillMaterialOption) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", code: "", category_id: "", unit_id: "", hsn_sac: "",
  });
  const matches = filterBillMaterials(materials, value);
  const exact = materials.some(m => m.name.trim().toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  const selected = materials.find(m => m.id === materialId);
  const canOfferCreate = !!value.trim() && !exact && canCreate && !!categories.length && !!units.length && !loading && !error;

  const create = useMutation({
    mutationFn: async () => {
      const name = form.name.trim();
      const code = form.code.trim().toUpperCase();
      if (name.length < 2 || name.length > 250) throw new Error("Material name must be 2–250 characters.");
      if (!/^[A-Z0-9-]{2,24}$/.test(code)) throw new Error("Use 2–24 uppercase letters, numbers or hyphens in the material code.");
      if (!categories.some(c => c.id === form.category_id)) throw new Error("Select an existing material category.");
      if (!units.some(u => u.id === form.unit_id)) throw new Error("Select an existing unit of measurement.");
      if (form.hsn_sac.trim().length > 30) throw new Error("HSN/SAC must be at most 30 characters.");
      // Re-check the remote master, not just the suggestions cached in the form.
      const { data: companies, error: companyError } = await supabase.from("companies").select("id").limit(2);
      if (companyError) throw companyError;
      const companyId = requireSingleCompanyId(companies);
      const { data: alreadyExists, error: duplicateError } = await supabase.from("items")
        .select("id,name").eq("company_id", companyId).ilike("name", name.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_"))
        .limit(20);
      if (duplicateError) throw duplicateError;
      if ((alreadyExists ?? []).some(m => m.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
        throw new Error("A material with this name already exists. Select it from the suggestions.");
      }
      const { data, error: insertError } = await supabase.from("items").insert({
        company_id: companyId,
        code, name, category_id: form.category_id, unit_id: form.unit_id,
        hsn_sac: form.hsn_sac.trim() || null,
        minimum_stock: 0, reorder_level: 0,
        status: "active",
      }).select("id,code,name,hsn_sac,category_id,unit_id,units_of_measure(code,name)").single();
      if (insertError) throw insertError;
      return data as BillMaterialOption;
    },
    onSuccess: async (material) => {
      // The invoice is left untouched; a new master entry does not create stock.
      qc.setQueryData<BillMaterialOption[]>(["old-bill-materials"], list =>
        [...(list ?? []).filter(x => x.id !== material.id), material].sort((a, b) => a.name.localeCompare(b.name)));
      await qc.invalidateQueries({ queryKey: ["materials"] });
      onPick(material);
      setOpen(false);
      setCreateOpen(false);
      toast.success("Material added and selected. Invoice entry preserved.");
    },
    onError: e => toast.error(errMsg(e)),
  });

  function startCreate() {
    setForm({
      name: value.trim(),
      code: autoCode(),
      category_id: "",
      unit_id: "",
      hsn_sac: "",
    });
    setOpen(false);
    setCreateOpen(true);
  }

  return <>
    <Popover open={open && !disabled && !createOpen} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            aria-label="Search material by name or code"
            aria-autocomplete="list"
            aria-expanded={open}
            disabled={disabled}
            value={value}
            maxLength={250}
            onFocus={() => setOpen(true)}
            onChange={e => { onType(e.target.value); setOpen(true); }}
            onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
            placeholder="Search material name or code…"
            className="pr-9"
          />
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" sideOffset={4} className="w-[min(94vw,420px)] p-1" onOpenAutoFocus={e => e.preventDefault()}>
        {loading && <p className="px-3 py-2 text-sm text-muted-foreground">Loading materials…</p>}
        {error && <p role="alert" className="px-3 py-2 text-sm text-destructive">Materials could not be loaded: {error}</p>}
        {!loading && !error && <>
          <p className="px-3 py-2 text-xs font-medium text-muted-foreground">Select from Materials master</p>
          <div role="listbox" aria-label="Matching construction materials" className="max-h-60 overflow-y-auto">
            {matches.map(material => <button
              key={material.id} type="button" role="option" aria-selected={materialId === material.id}
              className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
              onClick={() => { onPick(material); setOpen(false); }}>
              <span className="min-w-0"><span className="block truncate font-medium">{material.name}</span>
                <span className="block text-xs text-muted-foreground">{material.code} · {material.units_of_measure?.code ?? "No unit"}</span>
              </span>
              {material.id === materialId && <Check className="h-4 w-4 shrink-0 text-primary"/>}
            </button>)}
            {!matches.length && <p className="px-3 py-3 text-sm text-muted-foreground">No matching material in the master.</p>}
          </div>
          {canOfferCreate && <button type="button" onClick={startCreate}
            className="mt-1 flex w-full items-center gap-2 rounded-md border-t px-3 py-3 text-left text-sm font-medium text-primary hover:bg-accent">
            <Plus className="h-4 w-4 shrink-0"/> Create “{value.trim().slice(0,60)}” without leaving this bill
          </button>}
          {!!value.trim() && !exact && !canCreate && <p className="px-3 py-2 text-xs text-muted-foreground">
            You can enter an unlinked description, but only users with Materials Management permission can add master materials.
          </p>}
          <button type="button" onClick={()=>setOpen(false)} className="w-full border-t px-3 py-2 text-right text-xs text-muted-foreground hover:text-foreground">Close suggestions</button>
        </>}
      </PopoverContent>
    </Popover>
    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
      {materialId && selected ? <><Check className="h-3 w-3 text-emerald-600"/> From Materials master · {selected.code} · Unit {selected.units_of_measure?.code}</>
        : materialId ? "Linked to a material (master may be inactive)." :
        <>Not linked to master · <button type="button" disabled={disabled} className="font-medium text-primary hover:underline" onClick={()=>setOpen(true)}>Search materials</button></>}
      <ChevronsUpDown className="ml-auto h-3 w-3" aria-hidden/>
    </div>

    <Dialog open={createOpen} onOpenChange={next => { if (!create.isPending) setCreateOpen(next); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add material to master</DialogTitle>
          <DialogDescription>Create a reusable material while keeping your old bill, amounts and prior payments exactly as entered. Stock quantity starts at zero.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={e=>{e.preventDefault();if(!create.isPending)create.mutate();}}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor={"new-material-name-"+itemId}>Material name *</Label>
              <Input id={"new-material-name-"+itemId} required minLength={2} maxLength={250}
                value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
            </div>
            <div>
              <Label htmlFor={"new-material-code-"+itemId}>Material code *</Label>
              <Input id={"new-material-code-"+itemId} required maxLength={24}
                value={form.code} onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))}/>
            </div>
            <div>
              <Label htmlFor={"new-material-hsn-"+itemId}>HSN/SAC</Label>
              <Input id={"new-material-hsn-"+itemId} maxLength={30}
                value={form.hsn_sac} onChange={e=>setForm(f=>({...f,hsn_sac:e.target.value}))}/>
            </div>
            <div>
              <Label htmlFor={"new-material-category-"+itemId}>Category *</Label>
              <select id={"new-material-category-"+itemId} required className={cn("mt-1", "h-10 w-full rounded-md border bg-background px-3 text-sm")}
                value={form.category_id} onChange={e=>setForm(f=>({...f,category_id:e.target.value}))}>
                <option value="">Select category</option>
                {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor={"new-material-unit-"+itemId}>Master unit *</Label>
              <select id={"new-material-unit-"+itemId} required className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.unit_id} onChange={e=>setForm(f=>({...f,unit_id:e.target.value}))}>
                <option value="">Select unit</option>
                {units.map(u=><option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">This adds the material to the company's Materials master only. It will not create a GRN or change current stock.</p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={create.isPending} onClick={()=>setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !form.name.trim() || !form.category_id || !form.unit_id}>
              {create.isPending?"Creating…":"Create & select material"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
