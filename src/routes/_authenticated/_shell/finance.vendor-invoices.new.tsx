import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, Loading, PageHeader } from "@/components/erp/common";
import { errMsg, fmtDate, inr, num } from "@/lib/format";
import { selectCls } from "@/lib/po";
import { TAX_RATES } from "@/lib/rfq";
import { addDays, today, uploadVendorDoc, type FinanceSettings } from "@/lib/finance";
import { cn } from "@/lib/utils";

const META = "Enter a vendor bill against a purchase order and its goods receipts.";
export const Route = createFileRoute("/_authenticated/_shell/finance/vendor-invoices/new")({
  head: () => ({ meta: [{ title: "New Vendor Invoice — KK GROUP ERP" }, { name: "description", content: META }, { property: "og:title", content: "New Vendor Invoice — KK GROUP ERP" }, { property: "og:description", content: META }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  validateSearch: (s: Record<string, unknown>): { id?: string; po?: string } => ({ ...(typeof s["id"] === "string" ? { id: s["id"] as string } : {}), ...(typeof s["po"] === "string" ? { po: s["po"] as string } : {}) }),
  component: NewInvoice,
});

type Line = { grn_item_id: string; grn_number: string; material: string; unit: string; accepted: number; available: number; po_rate: number; po_tax: number; tax_type: string; quantity: string; rate: string; tax_rate_percent: string; include: boolean };

function NewInvoice() {
  const sp = Route.useSearch();
  const nav = useNavigate();
  const qc = useQueryClient();
  const editId = sp.id;
  const [vendor, setVendor] = useState("");
  const [po, setPo] = useState(sp.po ?? "");
  const [h, setH] = useState({ vendor_invoice_number: "", vendor_invoice_date: today(), due_date: "", freight: "0", other_charges: "0", tds_section: "", tds_rate: "0", remarks: "" });
  const [lines, setLines] = useState<Line[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [grnFilter, setGrnFilter] = useState<string>("");

  const existing = useQuery({
    queryKey: ["vi-edit", editId], enabled: !!editId,
    queryFn: async () => {
      const [i, it] = await Promise.all([
        supabase.from("vendor_invoices").select("*").eq("id", editId!).single(),
        supabase.from("vendor_invoice_items").select("*").eq("invoice_id", editId!),
      ]);
      if (i.error) throw i.error;
      return { inv: i.data, items: it.data ?? [] };
    },
  });
  useEffect(() => {
    const e = existing.data?.inv;
    if (!e) return;
    setVendor(e.vendor_id); setPo(e.po_id);
    setH({ vendor_invoice_number: e.vendor_invoice_number, vendor_invoice_date: e.vendor_invoice_date, due_date: e.due_date ?? "", freight: String(e.freight), other_charges: String(e.other_charges), tds_section: e.tds_section ?? "", tds_rate: String(e.tds_rate), remarks: e.remarks ?? "" });
  }, [existing.data]);

  const base = useQuery({
    queryKey: ["vi-form-base"],
    queryFn: async () => {
      const [p, c] = await Promise.all([
        supabase.from("purchase_orders").select("id,po_number,po_date,vendor_id,status,grand_total,payment_terms,projects(name),buildings(name),vendors(id,company_name,gstin,address,city,state,contact_person,mobile,email,payment_terms_days)")
          .in("status", ["partially_received", "fully_received", "closed"]).order("po_date", { ascending: false }),
        supabase.from("companies").select("finance_settings").limit(1).maybeSingle(),
      ]);
      if (p.error) throw p.error;
      return { pos: p.data ?? [], settings: (c.data?.finance_settings ?? null) as FinanceSettings | null };
    },
  });
  const pos = base.data?.pos ?? [];
  const vendors = useMemo(() => [...new Map(pos.map((p) => [p.vendor_id, p.vendors!])).values()], [pos]);
  useEffect(() => { if (sp.po && pos.length && !vendor) { const p = pos.find((x) => x.id === sp.po); if (p) setVendor(p.vendor_id); } }, [pos, sp.po, vendor]);
  const selPo = pos.find((p) => p.id === po);
  const selVendor = vendors.find((v) => v.id === vendor);

  useEffect(() => {
    if (selVendor && !h.due_date && !editId) setH((x) => ({ ...x, due_date: addDays(x.vendor_invoice_date, selVendor?.payment_terms_days ?? 30) }));
  }, [selVendor, editId, h.due_date]);

  const grn = useQuery({
    queryKey: ["vi-form-grn", po, editId], enabled: !!po,
    queryFn: async () => {
      const { data, error } = await supabase.from("goods_receipt_items")
        .select("id,accepted_quantity,unit_cost,goods_receipt_notes!inner(id,grn_number,received_date,status,po_id),items(code,name),units_of_measure(code),purchase_order_items(rate,tax_type,tax_rate_percent)")
        .eq("goods_receipt_notes.po_id", po).eq("goods_receipt_notes.status", "posted");
      if (error) throw error;
      const avail = await Promise.all((data ?? []).map((g) => supabase.rpc("grn_item_available", { _grn_item: g.id, _exclude_invoice: (editId ?? null) as string })));
      return (data ?? []).map((g, i) => ({ ...g, available: Number(avail[i]?.data ?? 0) }));
    },
  });
  useEffect(() => {
    if (!grn.data) return;
    const prev = existing.data?.items ?? [];
    setLines(grn.data.map((g) => {
      const e = prev.find((p) => p.grn_item_id === g.id);
      const poi = g.purchase_order_items;
      return {
        grn_item_id: g.id, grn_number: g.goods_receipt_notes.grn_number, material: `${g.items?.code} · ${g.items?.name}`, unit: g.units_of_measure?.code ?? "",
        accepted: Number(g.accepted_quantity), available: g.available, po_rate: Number(poi?.rate ?? 0), po_tax: Number(poi?.tax_rate_percent ?? 0), tax_type: poi?.tax_type ?? "cgst_sgst",
        quantity: e ? String(e.quantity) : String(g.available > 0 ? g.available : 0), rate: String(e ? e.rate : poi?.rate ?? 0),
        tax_rate_percent: String(e ? e.tax_rate_percent : poi?.tax_rate_percent ?? 0), include: e ? true : !editId && g.available > 0,
      };
    }));
  }, [grn.data, existing.data, editId]);

  const grnNumbers = [...new Set(lines.map((l) => l.grn_number))];
  const shown = lines.filter((l) => !grnFilter || l.grn_number === grnFilter);
  const upd = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.grn_item_id === id ? { ...l, ...patch } : l)));
  const active = lines.filter((l) => l.include && Number(l.quantity) > 0);
  const sub = active.reduce((a, l) => a + Number(l.quantity) * Number(l.rate), 0);
  const tax = active.reduce((a, l) => a + Number(l.quantity) * Number(l.rate) * Number(l.tax_rate_percent) / 100, 0);
  const extra = Number(h.freight || 0) + Number(h.other_charges || 0);
  const total = sub + tax + extra;
  const tds = (sub + extra) * Number(h.tds_rate || 0) / 100;
  const tdsSections = base.data?.settings?.tds_sections ?? [];

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      for (const l of active) if (Number(l.quantity) > l.available) throw new Error(`Cannot invoice ${l.quantity} of ${l.material} — only ${l.available} accepted and not yet invoiced`);
      const attachment_path = file ? await uploadVendorDoc("invoices", file) : "";
      const { data, error } = await supabase.rpc("save_vendor_invoice", {
        _id: (editId ?? null) as string,
        _header: { po_id: po, ...h, attachment_path },
        _items: active.map((l) => ({ grn_item_id: l.grn_item_id, quantity: Number(l.quantity), rate: Number(l.rate), tax_rate_percent: Number(l.tax_rate_percent), tax_type: l.tax_type })),
      });
      if (error) throw error;
      if (submit) { const r = await supabase.rpc("invoice_transition", { _id: data, _action: "submit", _comment: "" }); if (r.error) throw r.error; }
      return data as string;
    },
    onSuccess: (id) => { toast.success("Invoice saved"); qc.invalidateQueries({ queryKey: ["vendor-invoices"] }); qc.invalidateQueries({ queryKey: ["vi", id] }); nav({ to: "/finance/vendor-invoices/$id", params: { id } }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (base.isLoading || (editId && existing.isLoading)) return <Loading />;
  const canSave = po && h.vendor_invoice_number.trim() && h.vendor_invoice_date && active.length > 0;
  return (
    <>
      <PageHeader title={editId ? `Edit ${existing.data?.inv.invoice_number}` : "New vendor invoice"} subtitle="Select vendor → purchase order → goods receipts. Only accepted, not-yet-invoiced quantity can be billed." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 rounded-md border bg-card p-4 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vendor"><select className={selectCls} value={vendor} disabled={!!editId} onChange={(e) => { setVendor(e.target.value); setPo(""); }}><option value="">Select vendor</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}</select></Field>
            <Field label="Purchase order"><select className={selectCls} value={po} disabled={!!editId || !vendor} onChange={(e) => setPo(e.target.value)}><option value="">Select PO</option>{pos.filter((p) => p.vendor_id === vendor).map((p) => <option key={p.id} value={p.id}>{p.po_number} · {fmtDate(p.po_date)} · {inr(p.grand_total)}</option>)}</select></Field>
            <Field label="Vendor bill number"><Input value={h.vendor_invoice_number} onChange={(e) => setH({ ...h, vendor_invoice_number: e.target.value })} placeholder="As printed on the bill" /></Field>
            <Field label="Bill date"><Input type="date" value={h.vendor_invoice_date} onChange={(e) => setH({ ...h, vendor_invoice_date: e.target.value })} /></Field>
            <Field label="Due date"><Input type="date" value={h.due_date} onChange={(e) => setH({ ...h, due_date: e.target.value })} /></Field>
            <Field label="Invoice document (PDF / image)"><Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          </div>
          {vendors.length === 0 && <p className="text-xs text-muted-foreground">No purchase orders with received goods yet. Post a goods receipt first.</p>}
        </div>
        <div className="space-y-1 rounded-md border bg-card p-4 text-sm">
          {selVendor ? (<>
            <div className="font-medium">{selVendor.company_name}</div>
            <div className="text-xs text-muted-foreground">GSTIN {selVendor.gstin ?? "—"}</div>
            <div className="text-xs text-muted-foreground">{[selVendor.address, selVendor.city, selVendor.state].filter(Boolean).join(", ") || "No address"}</div>
            <div className="text-xs text-muted-foreground">{[selVendor.contact_person, selVendor.mobile, selVendor.email].filter(Boolean).join(" · ")}</div>
          </>) : <div className="text-xs text-muted-foreground">Vendor details appear here.</div>}
          {selPo && <div className="mt-3 border-t pt-2 text-xs"><div>PO <span className="font-mono">{selPo.po_number}</span> · {fmtDate(selPo.po_date)}</div><div>{selPo.projects?.name}{selPo.buildings?.name ? ` · ${selPo.buildings.name}` : ""}</div><div>PO value {inr(selPo.grand_total)} · Terms {selPo.payment_terms ?? "—"}</div></div>}
        </div>
      </div>

      {po && (
        <div className="mt-4 rounded-md border bg-card">
          <div className="flex items-center justify-between border-b p-3">
            <div className="text-sm font-medium">Invoice lines from goods receipts</div>
            <select className={cn(selectCls, "w-48")} value={grnFilter} onChange={(e) => setGrnFilter(e.target.value)}><option value="">All GRNs</option>{grnNumbers.map((g) => <option key={g}>{g}</option>)}</select>
          </div>
          {grn.isLoading ? <Loading /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3"></th><th className="px-4 py-3">GRN</th><th className="px-4 py-3">Material</th><th className="px-4 py-3 text-right">Accepted</th><th className="px-4 py-3 text-right">Available</th><th className="px-4 py-3 text-right">Invoice qty</th><th className="px-4 py-3 text-right">PO rate</th><th className="px-4 py-3 text-right">Bill rate</th><th className="px-4 py-3">GST %</th><th className="px-4 py-3 text-right">Amount</th></tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={10} className="p-3 text-xs text-muted-foreground">No posted goods receipts on this PO.</td></tr>}
                {shown.map((l) => {
                  const over = Number(l.quantity) > l.available;
                  const rateOff = Number(l.rate) !== l.po_rate; const taxOff = Number(l.tax_rate_percent) !== l.po_tax;
                  return (
                    <tr key={l.grn_item_id} className={cn("border-b last:border-0", !l.include && "opacity-50")}>
                      <td className="px-4 py-3"><input type="checkbox" checked={l.include} disabled={l.available <= 0} onChange={(e) => upd(l.grn_item_id, { include: e.target.checked })} aria-label="Include line" /></td>
                      <td className="px-4 py-3 font-medium tabular-nums text-xs">{l.grn_number}</td><td className="px-4 py-3">{l.material}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{num(l.accepted)} {l.unit}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{num(l.available)}</td>
                      <td className="px-4 py-3"><Input className={cn("h-8 w-24 text-right", over && "border-destructive")} type="number" min={0} value={l.quantity} onChange={(e) => upd(l.grn_item_id, { quantity: e.target.value })} /></td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{inr(l.po_rate)}</td>
                      <td className="px-4 py-3"><Input className={cn("h-8 w-28 text-right", rateOff && "border-amber-400")} type="number" min={0} value={l.rate} onChange={(e) => upd(l.grn_item_id, { rate: e.target.value })} /></td>
                      <td className="px-4 py-3"><select className={cn(selectCls, "h-8 w-20", taxOff && "border-amber-400")} value={l.tax_rate_percent} onChange={(e) => upd(l.grn_item_id, { tax_rate_percent: e.target.value })}>{[...new Set([...TAX_RATES, l.po_tax])].map((r) => <option key={r} value={r}>{r}</option>)}</select></td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{inr(Number(l.quantity) * Number(l.rate) * (1 + Number(l.tax_rate_percent) / 100))}</td>
                    </tr>);
                })}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 rounded-md border bg-card p-4 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Freight"><Input type="number" min={0} value={h.freight} onChange={(e) => setH({ ...h, freight: e.target.value })} /></Field>
            <Field label="Other charges"><Input type="number" min={0} value={h.other_charges} onChange={(e) => setH({ ...h, other_charges: e.target.value })} /></Field>
            <Field label="TDS section">
              <select className={selectCls} value={h.tds_section} onChange={(e) => { const s = tdsSections.find((t) => t.code === e.target.value); setH({ ...h, tds_section: e.target.value, tds_rate: String(s?.rate ?? 0) }); }}>
                <option value="">No TDS</option>{tdsSections.map((t) => <option key={t.code} value={t.code}>{t.code} · {t.label} ({t.rate}%)</option>)}
              </select>
            </Field>
            <Field label="TDS rate %"><Input type="number" min={0} value={h.tds_rate} onChange={(e) => setH({ ...h, tds_rate: e.target.value })} /></Field>
          </div>
          {tdsSections.length === 0 && <p className="text-xs text-muted-foreground">TDS sections are configured in Finance Settings.</p>}
          <Field label="Remarks"><Textarea rows={2} value={h.remarks} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></Field>
        </div>
        <div className="space-y-1 rounded-md border bg-card p-4 text-sm">
          {[["Taxable value", sub], ["GST", tax], ["Freight + other", extra], ["Gross invoice amount", total], ["TDS", -tds]].map(([k, v]) => <div key={k as string} className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="font-mono">{inr(v as number)}</span></div>)}
          <div className="flex justify-between border-t pt-2 font-semibold"><span>Net payable</span><span className="font-mono">{inr(total - tds)}</span></div>
          <div className="flex gap-2 pt-3">
            <Button variant="outline" disabled={!canSave || save.isPending} onClick={() => save.mutate(false)}>Save draft</Button>
            <Button disabled={!canSave || save.isPending} onClick={() => save.mutate(true)}>Save & run match</Button>
          </div>
        </div>
      </div>
    </>
  );
}
