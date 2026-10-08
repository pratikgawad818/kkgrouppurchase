import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loading, PageHeader } from "@/components/erp/common";
import { errMsg, fmtDate, inr, num } from "@/lib/format";
import { useCan } from "@/lib/session";
import { loadRfq } from "@/lib/rfq-data";

export const Route = createFileRoute("/_authenticated/_shell/procurement/rfqs/$id/compare")({
  head: () => ({ meta: [{ title: "Compare Quotations — KK GROUP ERP" }, { name: "description", content: "Side-by-side quotation comparison and vendor selection." }, { property: "og:title", content: "Compare Quotations — KK GROUP ERP" }, { property: "og:description", content: "Side-by-side quotation comparison and vendor selection." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Compare,
});

function Compare() {
  const { id } = Route.useParams();
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rfq", id], queryFn: () => loadRfq(id) });
  const [pick, setPick] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");

  const award = useMutation({
    mutationFn: async () => {
      const sel = Object.entries(pick).map(([rfq_item_id, quotation_item_id]) => ({ rfq_item_id, quotation_item_id }));
      const { error } = await supabase.rpc("record_vendor_selection", { _rfq_id: id, _selections: sel, _reason: reason.trim() });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Vendor selection recorded"); qc.invalidateQueries({ queryKey: ["rfq", id] }); qc.invalidateQueries({ queryKey: ["rfqs"] }); nav({ to: "/procurement/rfqs/$id", params: { id } }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="text-sm text-destructive">{errMsg(q.error)}</div>;
  const { rfq, items, vendors, quotes, selections } = q.data!;
  const cols = quotes.filter((x) => x.status !== "draft").map((qt) => ({ qt, v: vendors.find((v) => v.id === qt.rfq_vendor_id) }));
  const today = new Date().toISOString().slice(0, 10);
  const canSelect = can("quotation.select_vendor") && ["partially_responded", "fully_responded"].includes(rfq.status);
  const cell = (qtId: string, itemId: string) => cols.find((c) => c.qt.id === qtId)!.qt.vendor_quotation_items.find((x) => x.rfq_item_id === itemId);
  const lowest = (itemId: string) => {
    const r = cols.map((c) => c.qt.vendor_quotation_items.find((x) => x.rfq_item_id === itemId)).filter((x) => x?.is_quoted).map((x) => Number(x!.rate));
    return r.length ? Math.min(...r) : null;
  };
  const awardAll = (qtId: string) => {
    const p: Record<string, string> = {};
    for (const it of items) { const c = cell(qtId, it.id); if (c?.is_quoted) p[it.id] = c.id; }
    setPick(p);
  };
  const pickedTotal = Object.entries(pick).reduce((a, [itemId, qiId]) => {
    for (const c of cols) { const x = c.qt.vendor_quotation_items.find((y) => y.id === qiId && y.rfq_item_id === itemId); if (x) return a + Number(x.line_total); }
    return a;
  }, 0);

  return (
    <>
      <PageHeader crumbs={<Link to="/procurement/rfqs/$id" params={{ id }}>{rfq.rfq_number}</Link>} title="Quotation comparison" subtitle="Lowest rate per item is highlighted. Select a vendor per item, or award all items to one vendor." />
      {cols.length === 0 ? <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">No quotations recorded yet.</div> : (
        <div><p className="mb-2 text-xs text-muted-foreground sm:hidden">Swipe sideways to see every column →</p><div role="region" aria-label="Quotation comparison" tabIndex={0} className="overflow-x-auto rounded-xl border bg-card shadow-card [&_td]:whitespace-nowrap">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs">
              <tr><th className="px-4 py-3">Item</th>{cols.map(({ qt, v }) => (
                <th key={qt.id} className="min-w-48 p-2 align-top">
                  <div className="font-semibold">{v?.vendors?.company_name}</div>
                  <div className="font-normal text-muted-foreground">Ref {qt.quotation_number} · valid {fmtDate(qt.valid_until)}{qt.valid_until && qt.valid_until < today ? " (expired)" : ""}</div>
                  {canSelect && <Button size="sm" variant="outline" className="mt-1 h-7" onClick={() => awardAll(qt.id)}>Award all quoted items</Button>}
                </th>))}</tr>
            </thead>
            <tbody>
              {items.map((it) => { const lo = lowest(it.id); const sel = selections.find((s) => s.rfq_item_id === it.id); return (
                <tr key={it.id} className="border-b">
                  <td className="px-4 py-3 align-top"><div className="font-medium">{it.items?.name}</div><div className="text-xs text-muted-foreground">{num(it.requested_quantity)} {it.units_of_measure?.code}{it.target_rate != null ? ` · target ${inr(it.target_rate)}` : ""}</div></td>
                  {cols.map(({ qt }) => { const c = cell(qt.id, it.id); const chosen = sel ? sel.quotation_item_id === c?.id : pick[it.id] === c?.id; return (
                    <td key={qt.id} className={`p-2 align-top ${chosen ? "bg-primary/10" : ""}`}>
                      {!c || !c.is_quoted ? <span className="inline-flex rounded-sm border px-1.5 text-[11px] text-muted-foreground">Not quoted</span> : (
                        <label className={`block ${canSelect ? "cursor-pointer" : ""}`}>
                          <div className="flex items-center gap-2">
                            {canSelect && <input type="radio" name={it.id} checked={pick[it.id] === c.id} onChange={() => setPick({ ...pick, [it.id]: c.id })} />}
                            <span className={`font-mono ${Number(c.rate) === lo ? "font-semibold text-primary" : ""}`}>{inr(c.rate)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">Qty {num(c.quoted_quantity)}{Number(c.quoted_quantity) !== Number(it.requested_quantity) ? " (partial/different)" : ""} · tax {num(c.tax_rate_percent)}%{c.delivery_days != null ? ` · ${c.delivery_days}d` : ""}</div>
                          <div className="text-xs">Line {inr(c.line_total)}</div>
                        </label>)}
                    </td>); })}
                </tr>); })}
            </tbody>
            <tfoot className="text-xs">
              {([["Subtotal", "subtotal"], ["Discount", "discount_total"], ["Tax", "tax_total"], ["Freight", "freight"], ["Other charges", "other_charges"], ["Grand total (landed)", "grand_total"]] as const).map(([l, k]) => (
                <tr key={k} className="border-t"><td className="px-4 py-3 text-right text-muted-foreground">{l}</td>{cols.map(({ qt }) => <td key={qt.id} className={`p-2 font-mono ${k === "grand_total" ? "font-semibold" : ""}`}>{inr(qt[k])}</td>)}</tr>
              ))}
              <tr className="border-t"><td className="px-4 py-3 text-right text-muted-foreground">Delivery · Payment</td>{cols.map(({ qt }) => <td key={qt.id} className="p-2">{qt.delivery_days != null ? `${qt.delivery_days} days` : "—"} · {qt.payment_terms ?? "—"}</td>)}</tr>
            </tfoot>
          </table>
        </div>
      )}
      {canSelect && cols.length > 0 && (
        <section className="mt-4 rounded-md border bg-card p-4">
          <div className="mb-2 text-sm">Selected {Object.keys(pick).length} of {items.length} items · items value incl. tax <span className="font-mono font-semibold">{inr(pickedTotal)}</span> (freight/charges as per each quote)</div>
          <Textarea rows={2} placeholder="Reason for selection (required) — e.g. lowest landed cost, better delivery time" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="mt-3 flex items-center justify-end gap-3">
            {(Object.keys(pick).length !== items.length || !reason.trim()) && <span className="text-xs text-muted-foreground">{Object.keys(pick).length !== items.length ? "Pick a vendor for every item" : "Enter a reason to continue"}</span>}
            <Button disabled={award.isPending || !reason.trim() || Object.keys(pick).length !== items.length} onClick={() => award.mutate()}>Confirm selection · Ready for PO</Button>
          </div>
        </section>
      )}
      {rfq.status === "ready_for_po" && (
        <section className="mt-4 rounded-md border bg-card p-4 text-sm">
          Vendor selection is recorded. <Link className="font-medium text-primary underline" to="/procurement/rfqs/$id" params={{ id }}>Open the RFQ to create the purchase order</Link>.
        </section>
      )}
    </>
  );
}
