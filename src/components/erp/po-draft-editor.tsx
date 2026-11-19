import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/erp/common";
import { errMsg } from "@/lib/format";
import { TAX_RATES, TAX_TYPES } from "@/lib/rfq";

type PO = Database["public"]["Tables"]["purchase_orders"]["Row"];
type POLine = Database["public"]["Tables"]["purchase_order_items"]["Row"] & {
  items?: { name: string; code?: string } | null;
  units_of_measure?: { code: string } | null;
};
type EditLine = {
  id: string; description: string; ordered_quantity: string; rate: string;
  discount_amount: string; tax_type: string; tax_rate_percent: string;
};
const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm";

export function PoDraftEditor({
  po, items, warehouses, onDone,
}: {
  po: PO;
  items: POLine[];
  warehouses: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [header, setHeader] = useState({
    delivery_warehouse_id: po.delivery_warehouse_id ?? "",
    expected_delivery_date: po.expected_delivery_date ?? "",
    payment_terms: po.payment_terms ?? "",
    delivery_terms: po.delivery_terms ?? "",
    remarks: po.remarks ?? "",
  });
  const [lines, setLines] = useState<EditLine[]>(items.map((line) => ({
    id: line.id,
    description: line.description ?? "",
    ordered_quantity: String(line.ordered_quantity),
    rate: String(line.rate),
    discount_amount: String(line.discount_amount),
    tax_type: line.tax_type,
    tax_rate_percent: String(line.tax_rate_percent),
  })));
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (reason.trim().length < 3) throw new Error("Enter a correction reason (at least 3 characters).");
      const revised = lines.map((line) => ({
        id: line.id,
        description: line.description,
        ordered_quantity: Number(line.ordered_quantity),
        rate: Number(line.rate),
        discount_amount: Number(line.discount_amount),
        tax_type: line.tax_type,
        tax_rate_percent: Number(line.tax_rate_percent),
      }));
      if (!revised.length || revised.some((line) =>
        !Number.isFinite(line.ordered_quantity) || line.ordered_quantity <= 0 ||
        !Number.isFinite(line.rate) || line.rate < 0 ||
        !Number.isFinite(line.discount_amount) || line.discount_amount < 0 ||
        line.discount_amount > Math.round(line.ordered_quantity * line.rate * 100) / 100 ||
        !Number.isFinite(line.tax_rate_percent) ||
        line.tax_rate_percent < 0 || line.tax_rate_percent > 28
      )) throw new Error("Check quantity, rate, discount and GST for every line.");
      const { error } = await supabase.rpc("revise_po_draft", {
        _po_id: po.id,
        _expected_updated_at: po.updated_at,
        _header: header,
        _items: revised,
        _reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`${po.po_number} saved with its original number and a revision record`);
      qc.invalidateQueries({ queryKey: ["po", po.id] });
      qc.invalidateQueries({ queryKey: ["pos"] });
      qc.invalidateQueries({ queryKey: ["procurement-revisions", "purchase_order", po.id] });
      onDone();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const setLine = (i: number, patch: Partial<EditLine>) =>
    setLines((rows) => rows.map((line, index) => index === i ? { ...line, ...patch } : line));
  const setHead = (key: keyof typeof header, value: string) =>
    setHeader((current) => ({ ...current, [key]: value }));

  return (
    <section className="mt-4 space-y-4 rounded-xl border-2 border-primary/25 bg-card p-4 shadow-sm" aria-label="Edit existing purchase order">
      <header>
        <h2 className="font-semibold">Edit original PO · {po.po_number}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Permitted for draft or rejected orders only. The original vendor, quotation and
          material references stay locked. Submit again for approval after correction.
        </p>
      </header>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Delivery store *">
          <select aria-label="PO delivery store" className={selectClass}
            value={header.delivery_warehouse_id}
            onChange={(e) => setHead("delivery_warehouse_id", e.target.value)}>
            <option value="">Select store</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Expected delivery">
          <Input aria-label="PO expected delivery" type="date" value={header.expected_delivery_date}
            onChange={(e) => setHead("expected_delivery_date", e.target.value)} />
        </Field>
        <Field label="Payment terms">
          <Input aria-label="PO payment terms" value={header.payment_terms}
            onChange={(e) => setHead("payment_terms", e.target.value)} />
        </Field>
        <Field label="Delivery terms">
          <Input aria-label="PO delivery terms" value={header.delivery_terms}
            onChange={(e) => setHead("delivery_terms", e.target.value)} />
        </Field>
        <Field label="Remarks" className="md:col-span-2">
          <Textarea aria-label="PO remarks" rows={2} value={header.remarks}
            onChange={(e) => setHead("remarks", e.target.value)} />
        </Field>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">PO material and commercial lines</h3>
        <div className="space-y-3">
          {lines.map((line, index) => {
            const old = items.find((i) => i.id === line.id);
            return (
              <div key={line.id} className="rounded-lg border p-3">
                <div className="mb-2 text-sm font-medium">
                  {old?.items?.name ?? `Line ${index + 1}`}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {old?.units_of_measure?.code ?? ""}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <Field label="Quantity">
                    <Input type="number" min="0.001" step="any" value={line.ordered_quantity}
                      aria-label={`PO line ${index + 1} quantity`}
                      onChange={(e) => setLine(index, { ordered_quantity: e.target.value })} />
                  </Field>
                  <Field label="Rate (₹)">
                    <Input type="number" min="0" step="0.01" value={line.rate}
                      aria-label={`PO line ${index + 1} rate`}
                      onChange={(e) => setLine(index, { rate: e.target.value })} />
                  </Field>
                  <Field label="Discount (₹)">
                    <Input type="number" min="0" step="0.01" value={line.discount_amount}
                      aria-label={`PO line ${index + 1} discount`}
                      onChange={(e) => setLine(index, { discount_amount: e.target.value })} />
                  </Field>
                  <Field label="Tax type">
                    <select className={selectClass} aria-label={`PO line ${index + 1} tax type`}
                      value={line.tax_type}
                      onChange={(e) => setLine(index, {
                        tax_type: e.target.value,
                        tax_rate_percent: e.target.value === "none" ? "0" : line.tax_rate_percent,
                      })}>
                      {TAX_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                    </select>
                  </Field>
                  <Field label="GST rate">
                    <select className={selectClass} aria-label={`PO line ${index + 1} GST rate`}
                      value={line.tax_rate_percent} disabled={line.tax_type === "none"}
                      onChange={(e) => setLine(index, { tax_rate_percent: e.target.value })}>
                      {TAX_RATES.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
                    </select>
                  </Field>
                  <div className="sm:col-span-2 lg:col-span-5">
                    <Field label="Description / specification">
                      <Input value={line.description}
                        onChange={(e) => setLine(index, { description: e.target.value })} />
                    </Field>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <label className="block text-sm">Reason for correction *
        <Textarea rows={2} className="mt-1" value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="For example: supplier corrected unit rate and delivery date." />
      </label>
      <p className="text-xs text-muted-foreground">
        Revised items are recalculated server-side. Orders with a challan, receipt or vendor
        invoice cannot be revised. Previous approvals and snapshots remain visible.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onDone} disabled={save.isPending}>Close without saving</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save original PO revision"}
        </Button>
      </div>
    </section>
  );
}
