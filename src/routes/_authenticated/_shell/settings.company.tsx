import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Building2, FileCheck2, Image as ImageIcon, MapPin, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loading } from "@/components/erp/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCan } from "@/lib/session";
import brandMark from "@/assets/kk-groups-full.png.asset.json";

export const Route = createFileRoute("/_authenticated/_shell/settings/company")({
  head: () => ({
    meta: [
      { title: "Company Settings — KK Group ERP" },
      { name: "description", content: "Manage KK Group company, contact, tax, and registration details." },
      { property: "og:title", content: "Company Settings — KK Group ERP" },
      { property: "og:description", content: "Manage KK Group company, contact, tax, and registration details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Company,
});

type CompanyForm = {
  name: string;
  legal_name: string;
  phone: string;
  email: string;
  pan: string;
  tan: string;
  gstin: string;
  cin: string;
  rera_promoter_id: string;
  registered_address: string;
  office_address: string;
};

const EMPTY_FORM: CompanyForm = {
  name: "",
  legal_name: "",
  phone: "",
  email: "",
  pan: "",
  tan: "",
  gstin: "",
  cin: "",
  rera_promoter_id: "",
  registered_address: "",
  office_address: "",
};

function Company() {
  const can = useCan();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CompanyForm>(EMPTY_FORM);
  const query = useQuery({
    queryKey: ["company"],
    queryFn: async () => {
      const result = await supabase.from("companies").select("*").limit(1).single();
      if (result.error) throw result.error;
      return result.data;
    },
  });

  useEffect(() => {
    const company = query.data;
    if (!company) return;
    setForm({
      name: company.name,
      legal_name: company.legal_name ?? "",
      phone: company.phone ?? "",
      email: company.email ?? "",
      pan: company.pan ?? "",
      tan: company.tan ?? "",
      gstin: company.gstin ?? "",
      cin: company.cin ?? "",
      rera_promoter_id: company.rera_promoter_id ?? "",
      registered_address: company.registered_address ?? "",
      office_address: company.office_address ?? "",
    });
  }, [query.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!query.data) throw new Error("Company is unavailable.");
      const result = await supabase.from("companies").update(form).eq("id", query.data.id);
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["company"] });
      toast.success("Company settings updated");
    },
    onError: (error) => toast.error(error.message),
  });

  if (query.isLoading) return <Loading />;
  if (!query.data) return null;
  const editable = can("company.manage");
  const setValue = (key: keyof CompanyForm, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="mx-auto max-w-5xl overflow-hidden rounded-lg border bg-card shadow-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (editable) save.mutate();
      }}
    >
      <header className="flex min-h-16 flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Settings</span><span aria-hidden="true">/</span><span className="font-medium text-foreground">Company Profile</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Company identity used across ERP records and documents.</p>
        </div>
        {editable && (
          <Button type="submit" size="sm" disabled={save.isPending || !form.name.trim()}>
            <Save className="h-4 w-4" />{save.isPending ? "Saving…" : "Save changes"}
          </Button>
        )}
      </header>

      <div className="space-y-10 p-5 sm:p-7 lg:p-9">
        <section aria-labelledby="company-basic-heading">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground"><Building2 className="h-4 w-4" /></div>
            <div>
              <h2 id="company-basic-heading" className="text-base font-semibold">Basic information</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Identity and contact details shown on official documents.</p>
            </div>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="flex min-h-24 items-center gap-5 rounded-md border bg-muted/30 p-4 sm:col-span-2">
              <div className="grid h-20 w-28 shrink-0 place-items-center overflow-hidden rounded-md border bg-card p-1.5">
                <img src={brandMark.url} alt="KK Groups logo" className="h-full w-full object-contain" />
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm font-medium"><ImageIcon className="h-4 w-4 text-muted-foreground" />Organization logo</div>
                <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">The full KK Groups logo is used in the workspace and on printable purchase documents.</p>
              </div>
            </div>
            <FormField label="Display name" required><Input required disabled={!editable} value={form.name} onChange={(e) => setValue("name", e.target.value)} /></FormField>
            <FormField label="Legal company name"><Input disabled={!editable} value={form.legal_name} onChange={(e) => setValue("legal_name", e.target.value)} /></FormField>
            <FormField label="Primary email"><Input type="email" disabled={!editable} value={form.email} onChange={(e) => setValue("email", e.target.value)} /></FormField>
            <FormField label="Contact number"><Input disabled={!editable} value={form.phone} onChange={(e) => setValue("phone", e.target.value)} /></FormField>
          </div>
        </section>

        <section className="border-t pt-8" aria-labelledby="company-address-heading">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground"><MapPin className="h-4 w-4" /></div>
            <div><h2 id="company-address-heading" className="text-base font-semibold">Business addresses</h2><p className="mt-0.5 text-xs text-muted-foreground">Registered and operating addresses for correspondence.</p></div>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <FormField label="Registered address"><Textarea rows={3} disabled={!editable} value={form.registered_address} onChange={(e) => setValue("registered_address", e.target.value)} /></FormField>
            <FormField label="Office address"><Textarea rows={3} disabled={!editable} value={form.office_address} onChange={(e) => setValue("office_address", e.target.value)} /></FormField>
          </div>
        </section>

        <section className="border-t pt-8" aria-labelledby="company-legal-heading">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground"><FileCheck2 className="h-4 w-4" /></div>
            <div><h2 id="company-legal-heading" className="text-base font-semibold">Legal & registration</h2><p className="mt-0.5 text-xs text-muted-foreground">Tax and statutory identifiers used for procurement and finance.</p></div>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label="GSTIN"><Input disabled={!editable} value={form.gstin} onChange={(e) => setValue("gstin", e.target.value)} /></FormField>
            <FormField label="PAN"><Input disabled={!editable} value={form.pan} onChange={(e) => setValue("pan", e.target.value)} /></FormField>
            <FormField label="TAN"><Input disabled={!editable} value={form.tan} onChange={(e) => setValue("tan", e.target.value)} /></FormField>
            <FormField label="CIN"><Input disabled={!editable} value={form.cin} onChange={(e) => setValue("cin", e.target.value)} /></FormField>
            <FormField label="RERA promoter ID" className="sm:col-span-2"><Input disabled={!editable} value={form.rera_promoter_id} onChange={(e) => setValue("rera_promoter_id", e.target.value)} /></FormField>
          </div>
        </section>
      </div>
    </form>
  );
}

function FormField({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <div className={className}><Label className="mb-1.5 block text-xs font-medium">{label}{required && <span className="text-destructive"> *</span>}</Label>{children}</div>;
}