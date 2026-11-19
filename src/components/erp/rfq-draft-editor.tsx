import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errMsg, num } from "@/lib/format";
import { loadRfq } from "@/lib/rfq-data";

type RfqData = Awaited<ReturnType<typeof loadRfq>>;
type DraftLine = { included: boolean; quantity: string };

export function RfqDraftEditor({
  data, onDone,
}: {
  data: RfqData;
  onDone: () => void;
}) {
  const { rfq } = data;
  const qc = useQueryClient();
  const ready = useRef(false);
  const [due, setDue] = useState(rfq.response_due_date);
  const [remarks, setRemarks] = useState(rfq.remarks ?? "");
  const [reason, setReason] = useState("");
  const [selectedVendors, setSelectedVendors] = useState<string[]>(
    data.vendors.map((v) => v.vendor_id),
  );
  const [vendorSearch, setVendorSearch] = useState("");
  const [lines, setLines] = useState<Record<string, DraftLine>>({});

  const sourceLines = useQuery({
    queryKey: ["rfq-revision-pr-items", rfq.purchase_request_id],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("purchase_request_items")
        .select("id,line_no,quantity,items(name,code),units_of_measure(code)")
        .eq("purchase_request_id", rfq.purchase_request_id)
        .order("line_no");
      if (error) throw error;
      return rows ?? [];
    },
  });
  const suppliers = useQuery({
    queryKey: ["rfq-revision-suppliers"],
    queryFn: async () => {
      const { data: rows, error } = await supabase.from("vendors")
        .select("id,company_name,code")
        .eq("status", "active")
        .order("company_name");
      if (error) throw error;
      return rows ?? [];
    },
  });
  useEffect(() => {
    if (!sourceLines.data || ready.current) return;
    const existing = new Map(data.items.map((i) => [i.pr_item_id, i.requested_quantity]));
    setLines(Object.fromEntries(sourceLines.data.map((source) => [
      source.id, {
        included: existing.has(source.id),
        quantity: String(existing.get(source.id) ?? source.quantity),
      },
    ])));
    ready.current = true;
  }, [data.items, sourceLines.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!due) throw new Error("Enter the response due date.");
      if (reason.trim().length < 3) throw new Error("Explain why this RFQ is being revised.");
      const chosen = (sourceLines.data ?? [])
        .filter((item) => lines[item.id]?.included)
        .map((item) => ({
          pr_item_id: item.id,
          requested_quantity: Number(lines[item.id]?.quantity),
        }));
      if (!chosen.length) throw new Error("Include at least one material.");
      if (chosen.some((item) => !Number.isFinite(item.requested_quantity) || item.requested_quantity <= 0)) {
        throw new Error("Every included material requires a positive quantity.");
      }
      if (!selectedVendors.length) throw new Error("Select at least one vendor.");
      const { error } = await supabase.rpc("revise_rfq_draft", {
        _rfq_id: rfq.id,
        _expected_updated_at: rfq.updated_at,
        _header: { response_due_date: due, remarks },
        _items: chosen,
        _vendor_ids: selectedVendors,
        _reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`${rfq.rfq_number} revised — document number unchanged`);
      qc.invalidateQueries({ queryKey: ["rfq", rfq.id] });
      qc.invalidateQueries({ queryKey: ["rfqs"] });
      qc.invalidateQueries({ queryKey: ["procurement-revisions", "rfq", rfq.id] });
      onDone();
    },
    onError: (error) => toast.error(errMsg(error)),
  });

  const visibleSuppliers = (suppliers.data ?? []).filter((vendor) =>
    (vendor.company_name + " " + vendor.code).toLowerCase().includes(vendorSearch.toLowerCase()),
  );

  return (
    <section className="mb-5 space-y-4 rounded-xl border-2 border-primary/25 bg-card p-4 shadow-sm" aria-label="Edit existing RFQ">
      <div>
        <h2 className="text-base font-semibold">Edit existing RFQ · {rfq.rfq_number}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Draft only. You can change quantities, invited vendors, due date and notes.
          Materials must come from the linked approved PR. This saves a permanent revision.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Response due date *
          <Input type="date" className="mt-1" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="text-sm">Remarks / terms
          <Textarea rows={2} className="mt-1" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </label>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Materials from {data.rfq.purchase_requests?.pr_number ?? "linked PR"}</h3>
        {sourceLines.error && <p role="alert" className="text-sm text-destructive">{errMsg(sourceLines.error)}</p>}
        {sourceLines.isLoading ? <p className="text-xs text-muted-foreground">Loading original materials…</p> : (
          <div className="space-y-2">
            {(sourceLines.data ?? []).map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-2">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-primary"
                    checked={!!lines[item.id]?.included}
                    onChange={(e) => setLines((old) => ({
                      ...old, [item.id]: { ...old[item.id]!, included: e.target.checked },
                    }))}
                  />
                  <span>{item.items?.name ?? "Material"} <span className="text-xs text-muted-foreground">({num(item.quantity)} {item.units_of_measure?.code} in PR)</span></span>
                </label>
                <label className="text-xs">RFQ quantity
                  <Input aria-label={`Quantity for ${item.items?.name ?? "material"}`}
                    type="number" min="0.001" step="any" className="mt-1 w-28"
                    disabled={!lines[item.id]?.included}
                    value={lines[item.id]?.quantity ?? ""}
                    onChange={(e) => setLines((old) => ({
                      ...old, [item.id]: { ...old[item.id]!, quantity: e.target.value },
                    }))} />
                </label>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Invited vendors ({selectedVendors.length})</h3>
          <Input value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)}
            placeholder="Search vendors" className="w-full sm:w-56" />
        </div>
        {suppliers.error && <p role="alert" className="text-sm text-destructive">{errMsg(suppliers.error)}</p>}
        <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
          {visibleSuppliers.map((vendor) => (
            <label key={vendor.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary"
                checked={selectedVendors.includes(vendor.id)}
                onChange={(e) => setSelectedVendors((old) =>
                  e.target.checked ? [...old, vendor.id] : old.filter((v) => v !== vendor.id))}
              />
              {vendor.company_name}
            </label>
          ))}
        </div>
      </div>
      <label className="block text-sm">Reason for revision *
        <Textarea rows={2} className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Explain the change, for example: revised cement quantity after site verification." />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" type="button" onClick={onDone} disabled={save.isPending}>Cancel editing</Button>
        <Button type="button" onClick={() => save.mutate()}
          disabled={save.isPending || sourceLines.isLoading || !sourceLines.data?.length || suppliers.isLoading}>
          {save.isPending ? "Saving…" : "Save RFQ revision"}
        </Button>
      </div>
    </section>
  );
}
