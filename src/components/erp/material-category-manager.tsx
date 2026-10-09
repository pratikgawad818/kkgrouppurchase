import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { requireSingleCompanyId } from "@/lib/company-scope";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loading } from "@/components/erp/common";

type Category = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  parent_id: string | null;
};

type CategoryForm = {
  code: string;
  name: string;
  description: string;
  status: Category["status"];
  parent_id: string;
};

const INITIAL_FORM: CategoryForm = {
  code: "",
  name: "",
  description: "",
  status: "active",
  parent_id: "",
};

export function MaterialCategoryManager({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Category | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [form, setForm] = useState<CategoryForm>(INITIAL_FORM);

  const categories = useQuery({
    queryKey: ["material-category-manager"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("item_categories")
        .select("id,code,name,description,status,parent_id")
        .order("name")
        .limit(501);
      if (error) throw error;
      return data as Category[];
    },
  });

  function reset() {
    setEditing(null);
    setForm(INITIAL_FORM);
    setShowEditor(false);
  }

  function changeOpen(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function edit(row?: Category) {
    setEditing(row ?? null);
    setForm(row ? {
      code: row.code,
      name: row.name,
      description: row.description ?? "",
      status: row.status,
      parent_id: row.parent_id ?? "",
    } : INITIAL_FORM);
    setShowEditor(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const code = form.code.trim().toUpperCase();
      const name = form.name.trim();
      if (!/^[A-Z0-9][A-Z0-9_-]{1,29}$/.test(code)) {
        throw new Error("Use 2–30 letters, numbers, hyphens or underscores for the category code.");
      }
      if (name.length < 2 || name.length > 120) {
        throw new Error("Enter a category name between 2 and 120 characters.");
      }
      const common = {
        code,
        name,
        description: form.description.trim() || null,
        status: form.status,
      };
      if (editing) {
        const { error } = await supabase.from("item_categories")
          .update(common).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { data: companies, error: companyError } = await supabase.from("companies")
          .select("id").limit(2);
        if (companyError) throw companyError;
        const companyId = requireSingleCompanyId(companies);
        const { error } = await supabase.from("item_categories").insert({
          ...common,
          company_id: companyId,
          parent_id: form.parent_id || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["material-category-manager"] }),
        qc.invalidateQueries({ queryKey: ["material-refs"] }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      toast.success(editing ? "Material category updated" : "Material category created");
      reset();
    },
    onError: error => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Material categories</DialogTitle>
          <DialogDescription>
            Organise items into construction-material groups. Categories must exist before you can register materials.
          </DialogDescription>
        </DialogHeader>

        {!showEditor && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Categories can be deactivated rather than deleting materials already using them.</p>
              <Button size="sm" type="button" onClick={() => edit()}>
                <FolderPlus className="h-4 w-4" /> New category
              </Button>
            </div>
            {categories.isLoading ? <Loading /> : categories.error ? (
              <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
                Could not load material categories: {categories.error.message}
                <Button variant="outline" size="sm" className="mt-2" onClick={() => categories.refetch()}>Retry</Button>
              </div>
            ) : (categories.data?.length ?? 0) === 0 ? (
              <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center">
                <FolderPlus className="mx-auto h-7 w-7 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">No categories yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Start with categories such as Cement, Steel, Electrical, Plumbing or Finishes.
                </p>
                <Button className="mt-4" size="sm" type="button" onClick={() => edit()}>
                  <Plus className="h-4 w-4" /> Create first category
                </Button>
              </div>
            ) : (
              <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">
                {categories.data?.slice(0, 500).map(row => (
                  <div key={row.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{row.name}</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="font-mono">{row.code}</span>
                        {row.status !== "active" && " · Inactive"}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => edit(row)} aria-label={`Edit category ${row.name}`}>
                      <Pencil className="h-4 w-4" /> Edit
                    </Button>
                  </div>
                ))}
                {(categories.data?.length ?? 0) > 500 && (
                  <p className="p-3 text-xs text-muted-foreground">Displaying the first 500 categories.</p>
                )}
              </div>
            )}
          </>
        )}

        {showEditor && (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
            <div>
              <Label htmlFor="category-code">Category code</Label>
              <Input id="category-code" required maxLength={30} autoComplete="off"
                placeholder="CEMENT" value={form.code}
                onChange={e => setForm(previous => ({ ...previous, code: e.target.value.toUpperCase() }))} />
            </div>
            <div>
              <Label htmlFor="category-name">Category name</Label>
              <Input id="category-name" required maxLength={120}
                placeholder="Cement & Concrete" value={form.name}
                onChange={e => setForm(previous => ({ ...previous, name: e.target.value }))} />
            </div>
            {!editing && (
              <div>
                <Label htmlFor="category-parent">Parent category (optional)</Label>
                <select id="category-parent" className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.parent_id} onChange={e => setForm(previous => ({ ...previous, parent_id: e.target.value }))}>
                  <option value="">Top-level category</option>
                  {categories.data?.filter(item => item.status === "active").map(row =>
                    <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <Label htmlFor="category-status">Status</Label>
              <select id="category-status" className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.status} onChange={e => setForm(previous =>
                  ({ ...previous, status: e.target.value as Category["status"] }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="category-description">Description (optional)</Label>
              <Textarea id="category-description" rows={2} maxLength={600}
                value={form.description} onChange={e => setForm(previous =>
                  ({ ...previous, description: e.target.value }))} />
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t pt-4 sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => reset()}>Back</Button>
              <Button type="submit" disabled={save.isPending || !form.code.trim() || !form.name.trim()}>
                {save.isPending ? "Saving…" : editing ? "Save changes" : "Create category"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
