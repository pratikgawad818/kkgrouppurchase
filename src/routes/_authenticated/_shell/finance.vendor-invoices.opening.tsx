import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, Loading, PageHeader } from "@/components/erp/common";
import { errMsg, inr } from "@/lib/format";
import { selectCls } from "@/lib/po";
import { today, uploadVendorDoc } from "@/lib/finance";

const META = "Record an old vendor bill that has no purchase order or goods receipt in the ERP.";
export const Route = createFileRoute("/_authenticated/_shell/finance/vendor-invoices/opening")({
  head: () => ({ meta: [{ title: "Old Vendor Bill — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "Old Vendor Bill — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: OpeningBill,
});

const n = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0);

function OpeningBill() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState({ vendor_id: "", project_id: "", building_id: "", vendor_invoice_number: "", vendor_invoice_date: today(), due_date: "", subtotal: "", tax_total: "0", igst: false, freight: "0", other_charges: "0", tds_section: "", tds_rate: "0", amount_paid: "0", remarks: "" });
  const [file, setFile] = useState<File | null>(null);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  const base = useQuery({
    queryKey: ["opening-bill-base"],
    queryFn: async () => {
      const [v, p, b] = await Promise.all([
        supabase.from("vendors").select("id,company_name").order("company_name"),
        supabase.from("projects").select("id,name").order("name"),
        supabase.from("buildings").select("id,name,project_id").order("name"),
      ]);
      if (v.error) throw v.error; if (p.error) throw p.error; if (b.error) throw b.error;
      return { vendors: v.data ?? [], projects: p.data ?? [], buildings: b.data ?? [] };
    },
  });

  const gross = n(f.subtotal) + n(f.tax_total) + n(f.freight) + n(f.other_charges);
  const tds = Math.round(n(f.subtotal) * n(f.tds_rate)) / 100;
  const net = gross - tds;

  const save = useMutation({
    mutationFn: async () => {
      if (!f.vendor_id || !f.project_id) throw new Error("Choose the vendor and project.");
      const attachment_path = file ? await uploadVendorDoc("invoices", file) : "";
      const { data, error } = await supabase.rpc("save_opening_vendor_invoice", { _header: { ...f, attachment_path } });
      if (error) {
        if (error.message.startsWith("DUPLICATE_INVOICE")) throw new Error(`This bill number is already entered as ${error.message.split("|")[2]}.`);
        throw error;
      }
      return data as string;
    },
    onSuccess: (id) => { toast.success("Old bill saved — waiting for approval"); qc.invalidateQueries(); nav({ to: "/finance/vendor-invoices/$id", params: { id } }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (base.isLoading) return <Loading />;
  const d = base.data!;
  const blds = d.buildings.filter((b) => b.project_id === f.project_id);

  return (
    <div className="space-y-6">
      <PageHeader title="Old vendor bill" subtitle="For bills from before the ERP — no purchase order or goods receipt needed. It goes for approval like any other bill, then can be paid." />
      <div className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Vendor *"><select className={selectCls} value={f.vendor_id} onChange={(e) => set("vendor_id", e.target.value)}><option value="">Select vendor</option>{d.vendors.map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}</select></Field>
        <Field label="Project *"><select className={selectCls} value={f.project_id} onChange={(e) => setF((x) => ({ ...x, project_id: e.target.value, building_id: "" }))}><option value="">Select project</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Building"><select className={selectCls} value={f.building_id} onChange={(e) => set("building_id", e.target.value)}><option value="">—</option>{blds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Vendor bill number *"><Input value={f.vendor_invoice_number} onChange={(e) => set("vendor_invoice_number", e.target.value)} /></Field>
        <Field label="Bill date *"><Input type="date" value={f.vendor_invoice_date} onChange={(e) => set("vendor_invoice_date", e.target.value)} /></Field>
        <Field label="Due date"><Input type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} /></Field>
        <Field label="Amount before tax (₹) *"><Input inputMode="decimal" value={f.subtotal} onChange={(e) => set("subtotal", e.target.value)} /></Field>
        <Field label="GST amount (₹)"><Input inputMode="decimal" value={f.tax_total} onChange={(e) => set("tax_total", e.target.value)} /></Field>
        <Field label="GST type"><select className={selectCls} value={f.igst ? "igst" : "cgst"} onChange={(e) => set("igst", e.target.value === "igst")}><option value="cgst">CGST + SGST (same state)</option><option value="igst">IGST (other state)</option></select></Field>
        <Field label="Freight (₹)"><Input inputMode="decimal" value={f.freight} onChange={(e) => set("freight", e.target.value)} /></Field>
        <Field label="Other charges (₹)"><Input inputMode="decimal" value={f.other_charges} onChange={(e) => set("other_charges", e.target.value)} /></Field>
        <Field label="TDS section"><Input value={f.tds_section} onChange={(e) => set("tds_section", e.target.value)} placeholder="e.g. 194C" /></Field>
        <Field label="TDS %"><Input inputMode="decimal" value={f.tds_rate} onChange={(e) => set("tds_rate", e.target.value)} /></Field>
        <Field label="Already paid outside ERP (₹)"><Input inputMode="decimal" value={f.amount_paid} onChange={(e) => set("amount_paid", e.target.value)} /></Field>
        <Field label="Bill copy (optional)"><Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Remarks"><Textarea value={f.remarks} onChange={(e) => set("remarks", e.target.value)} /></Field></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="text-sm">Bill total <span className="num font-semibold">{inr(gross)}</span> · TDS <span className="num">{inr(tds)}</span> · Net payable <span className="num font-semibold">{inr(net)}</span> · Balance <span className="num font-semibold">{inr(net - n(f.amount_paid))}</span></div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save old bill"}</Button>
      </div>
    </div>
  );
}
