import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loading, PageHeader } from "@/components/erp/common";
import { errMsg, inr, num } from "@/lib/format";
import { lineCalc, TAX_RATES, TAX_TYPES } from "@/lib/rfq";
import { loadRfq } from "@/lib/rfq-data";

export const Route = createFileRoute("/_authenticated/_shell/procurement/rfqs/$id/quotation")({
  validateSearch: (s: Record<string, unknown>) => ({ vendor: typeof s["vendor"] === "string" ? s["vendor"] : "" }),
  head: () => ({ meta: [{ title: "Vendor Quotation — KK GROUP ERP" }, { name: "description", content: "Record a vendor's quotation against an RFQ." }, { property: "og:title", content: "Vendor Quotation — KK GROUP ERP" }, { property: "og:description", content: "Record a vendor's quotation against an RFQ." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: QuoteEntry,
});

type Line = { rfq_item_id: string; is_quoted: boolean; qty: string; rate: string; disc: string; taxType: string; taxPct: number; days: string; remarks: string };

function QuoteEntry() {
  const { id } = Route.useParams();
  const { vendor } = Route.useSearch();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rfq", id], queryFn: () => loadRfq(id) });
  const [h, setH] = useState({ quotation_number: "", quotation_date: new Date().toISOString().slice(0, 10), valid_until: "", delivery_days: "", payment_terms: "", freight: "0", other_charges: "0", remarks: "" });
  const [lines, setLines] = useState<Line[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!q.data || ready) return;
    const ex = q.data.quotes.find((x) => x.rfq_vendor_id === vendor);
    if (ex) setH({ quotation_number: ex.quotation_number, quotation_date: ex.quotation_date, valid_until: ex.valid_until ?? "", delivery_days: ex.delivery_days?.toString() ?? "", payment_terms: ex.payment_terms ?? "", freight: String(ex.freight), other_charges: String(ex.other_charges), remarks: ex.remarks ?? "" });
    setLines(q.data.items.map((it) => {
      const e = ex?.vendor_quotation_items.find((y) => y.rfq_item_id === it.id);
      return e ? { rfq_item_id: it.id, is_quoted: e.is_quoted, qty: String(e.quoted_quantity), rate: String(e.rate), disc: String(e.discount_amount), taxType: e.tax_type, taxPct: Number(e.tax_rate_percent), days: e.delivery_days?.toString() ?? "", remarks: e.remarks ?? "" }
        : { rfq_item_id: it.id, is_quoted: true, qty: String(it.requested_quantity), rate: "", disc: "0", taxType: "cgst_sgst", taxPct: 18, days: "", remarks: "" };
    }));
    setReady(true);
  }, [q.data, ready, vendor]);

  const save = useMutation({
    mutationFn: async () => {
      const d = q.data!;
      if (!h.quotation_number.trim()) throw new Error("Vendor quote reference is required");
      if (!lines.some((l) => l.is_quoted)) throw new Error("At least one item must be quoted");
      if (lines.some((l) => l.is_quoted && (!(Number(l.rate) > 0) || !(Number(l.qty) > 0)))) throw new Error("Enter quantity and rate for each quoted item");
      const ex = d.quotes.find((x) => x.rfq_vendor_id === vendor);
      const head = { quotation_number: h.quotation_number.trim(), quotation_date: h.quotation_date, valid_until: h.valid_until || null, delivery_days: h.delivery_days ? Number(h.delivery_days) : null, payment_terms: h.payment_terms || null, freight: Number(h.freight) || 0, other_charges: Number(h.other_charges) || 0, remarks: h.remarks || null };
      let qid = ex?.id;
      if (qid) { const { error } = await supabase.from("vendor_quotations").update(head).eq("id", qid); if (error) throw error; }
      else {
        const rv = d.vendors.find((v) => v.id === vendor)!;
        const { data, error } = await supabase.from("vendor_quotations").insert({ ...head, rfq_id: id, rfq_vendor_id: vendor, vendor_id: rv.vendor_id, status: "submitted" }).select("id").single();
        if (error) throw error; qid = data.id;
      }
      const rows = lines.map((l) => ({ quotation_id: qid!, rfq_item_id: l.rfq_item_id, is_quoted: l.is_quoted, quoted_quantity: Number(l.qty) || 0, rate: Number(l.rate) || 0, discount_amount: Number(l.disc) || 0, tax_type: l.taxType, tax_rate_percent: l.taxPct, delivery_days: l.days ? Number(l.days) : null, remarks: l.remarks || null }));
      const { error } = await supabase.from("vendor_quotation_items").upsert(rows, { onConflict: "quotation_id,rfq_item_id" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Quotation saved"); qc.invalidateQueries({ queryKey: ["rfq", id] }); qc.invalidateQueries({ queryKey: ["quotations"] }); nav({ to: "/procurement/rfqs/$id", params: { id } }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (q.isLoading || !ready) return <Loading />;
  if (q.error) return <div className="text-sm text-destructive">{errMsg(q.error)}</div>;
  const d = q.data!;
  const rv = d.vendors.find((v) => v.id === vendor);
  if (!rv) return <div className="text-sm text-muted-foreground">Vendor is not invited to this RFQ.</div>;
  const set = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const calcs = lines.map((l) => l.is_quoted ? lineCalc(Number(l.qty) || 0, Number(l.rate) || 0, Number(l.disc) || 0, l.taxPct, l.taxType) : { taxable: 0, tax: 0, total: 0 });
  const taxable = calcs.reduce((a, c) => a + c.taxable, 0), tax = calcs.reduce((a, c) => a + c.tax, 0);
  const grand = taxable + tax + (Number(h.freight) || 0) + (Number(h.other_charges) || 0);
  const hf = (k: keyof typeof h, label: string, type = "text") => <label className="text-sm">{label}<Input className="mt-1" type={type} value={h[k]} onChange={(e) => setH({ ...h, [k]: e.target.value })} /></label>;

  return (
    <>
      <PageHeader crumbs={<Link to="/procurement/rfqs/$id" params={{ id }}>{d.rfq.rfq_number}</Link>} title={`Quotation — ${rv.vendors?.company_name}`} subtitle="Enter the rates exactly as quoted by the vendor." />
      <section className="grid gap-3 rounded-md border bg-card p-4 sm:grid-cols-4">
        {hf("quotation_number", "Vendor quote ref *")}{hf("quotation_date", "Quote date", "date")}{hf("valid_until", "Valid until", "date")}{hf("delivery_days", "Delivery (days)", "number")}
        {hf("payment_terms", "Payment terms")}{hf("freight", "Freight (₹)", "number")}{hf("other_charges", "Other charges (₹)", "number")}{hf("remarks", "Remarks")}
      </section>
      <section className="mt-4 overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Quoted</th><th className="px-4 py-3">Material</th><th className="px-4 py-3">Qty</th><th className="px-4 py-3">Rate (₹)</th><th className="px-4 py-3">Discount (₹)</th><th className="px-4 py-3">Tax</th><th className="px-4 py-3">Days</th><th className="px-4 py-3 text-right">Line total</th></tr></thead>
          <tbody>{lines.map((l, i) => { const it = d.items[i]!; return (
            <tr key={l.rfq_item_id} className={`border-b last:border-0 ${l.is_quoted ? "" : "opacity-50"}`}>
              <td className="px-4 py-3"><input type="checkbox" className="h-4 w-4 accent-primary" checked={l.is_quoted} onChange={(e) => set(i, { is_quoted: e.target.checked })} /></td>
              <td className="px-4 py-3"><div>{it.items?.name}</div><div className="text-xs text-muted-foreground">Requested {num(it.requested_quantity)} {it.units_of_measure?.code}</div></td>
              <td className="px-4 py-3"><Input className="w-24" type="number" disabled={!l.is_quoted} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />{l.is_quoted && Number(l.qty) !== Number(it.requested_quantity) && <div className="mt-0.5 text-[10px] text-primary">Differs from requested</div>}</td>
              <td className="px-4 py-3"><Input className="w-28" type="number" disabled={!l.is_quoted} value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} /></td>
              <td className="px-4 py-3"><Input className="w-24" type="number" disabled={!l.is_quoted} value={l.disc} onChange={(e) => set(i, { disc: e.target.value })} /></td>
              <td className="px-4 py-3"><div className="flex gap-1">
                <select disabled={!l.is_quoted} className="h-9 rounded-md border bg-background px-1 text-xs" value={l.taxType} onChange={(e) => set(i, { taxType: e.target.value })}>{TAX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
                <select disabled={!l.is_quoted || l.taxType === "none"} className="h-9 rounded-md border bg-background px-1 text-xs" value={l.taxPct} onChange={(e) => set(i, { taxPct: Number(e.target.value) })}>{TAX_RATES.map((t) => <option key={t} value={t}>{t}%</option>)}</select>
              </div></td>
              <td className="px-4 py-3"><Input className="w-16" type="number" disabled={!l.is_quoted} value={l.days} onChange={(e) => set(i, { days: e.target.value })} /></td>
              <td className="px-4 py-3 text-right font-medium tabular-nums">{l.is_quoted ? inr(calcs[i]!.total) : "Not quoted"}</td>
            </tr>
          ); })}</tbody>
          <tfoot className="text-sm">
            <tr className="border-t"><td colSpan={7} className="p-2 text-right text-muted-foreground">Taxable value</td><td className="px-4 py-3 text-right font-medium tabular-nums">{inr(taxable)}</td></tr>
            <tr><td colSpan={7} className="p-2 text-right text-muted-foreground">Tax</td><td className="px-4 py-3 text-right font-medium tabular-nums">{inr(tax)}</td></tr>
            <tr><td colSpan={7} className="p-2 text-right text-muted-foreground">Freight + other charges</td><td className="px-4 py-3 text-right font-medium tabular-nums">{inr((Number(h.freight) || 0) + (Number(h.other_charges) || 0))}</td></tr>
            <tr className="border-t"><td colSpan={7} className="p-2 text-right font-semibold">Grand total</td><td className="px-4 py-3 text-right font-medium tabular-nums font-semibold">{inr(grand)}</td></tr>
          </tfoot>
        </table>
      </section>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" asChild><Link to="/procurement/rfqs/$id" params={{ id }}>Back</Link></Button><Button disabled={save.isPending} onClick={() => save.mutate()}>Save quotation</Button></div>
    </>
  );
}
