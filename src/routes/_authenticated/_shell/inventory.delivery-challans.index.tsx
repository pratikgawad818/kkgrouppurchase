import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus, Search, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Field, Loading, PageHeader } from "@/components/erp/common";
import { Pager } from "@/components/erp/pager";
import { errMsg, fmtDate, num } from "@/lib/format";
import { PAGE } from "@/lib/fy";
import { selectCls } from "@/lib/po";
import { useCan } from "@/lib/session";

const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
export const Route = createFileRoute("/_authenticated/_shell/inventory/delivery-challans/")({
  validateSearch: (s: Record<string, unknown>): { po: string | null } => ({
    po: typeof s["po"] === "string" && /^[a-f0-9-]{36}$/i.test(s["po"]) ? s["po"] : null,
  }),
  head: () => ({ meta: [{ title: "Vendor Delivery Challans — KK GROUP ERP" }] }),
  component: DeliveryChallanRegister,
});

function DeliveryChallanRegister() {
  const can = useCan();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const [open, setOpen] = useState(!!search.po);
  const [poId, setPoId] = useState(search.po ?? "");
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(0);
  const [h, setH] = useState({ challan_number: "", challan_date: todayIst(), vehicle_number: "", invoice_reference: "", remarks: "" });
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  useEffect(() => {
    if (search.po) { setPoId(search.po); setOpen(true); }
  }, [search.po]);

  const register = useQuery({
    queryKey: ["vendor-delivery-challans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendor_delivery_challans")
        .select("id,challan_number,challan_date,status,po_id,created_at,purchase_orders(po_number),vendors(company_name),projects(name),vendor_delivery_challan_items(quantity)")
        .order("created_at", { ascending: false }).limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const pos = useQuery({
    queryKey: ["challan-eligible-pos"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_orders")
        .select("id,po_number,status,vendors(company_name),projects(name)")
        .in("status", ["approved", "sent", "partially_received", "partially_accepted"])
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  const items = useQuery({
    queryKey: ["challan-po-lines", poId],
    enabled: open && !!poId,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_order_items")
        .select("id,line_no,ordered_quantity,accepted_quantity,short_closed_quantity,items(code,name),units_of_measure(code)")
        .eq("po_id", poId).order("line_no");
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const challan_number = h.challan_number.trim();
      if (!poId) throw new Error("Select an approved purchase order.");
      if (!challan_number) throw new Error("Enter the vendor challan number.");
      if (!h.challan_date || h.challan_date > todayIst()) throw new Error("Enter a challan date that is not in the future.");
      const lines = (items.data ?? []).flatMap(x => {
        const qty = Number(quantities[x.id] || 0);
        if (!Number.isFinite(qty) || qty < 0 || qty > Number(x.ordered_quantity) || Math.abs(qty * 1000 - Math.round(qty * 1000)) > 0.000001) {
          throw new Error(`Invalid dispatch quantity on line ${x.line_no}. Maximum ${num(x.ordered_quantity)} with up to 3 decimals.`);
        }
        return qty > 0 ? [{ po_item_id: x.id, quantity: qty }] : [];
      });
      if (!lines.length) throw new Error("Enter dispatched quantities for at least one material.");
      const { data, error } = await supabase.rpc("register_vendor_delivery_challan", { _po_id: poId, _header: { ...h, challan_number }, _items: lines });
      if (error) throw error;
      return data;
    },
    onSuccess: id => {
      toast.success("Delivery challan registered. No stock has been added.");
      qc.invalidateQueries({ queryKey: ["vendor-delivery-challans"] });
      qc.invalidateQueries({ queryKey: ["po"] });
      setOpen(false);
      setPoId("");
      setH({ challan_number: "", challan_date: todayIst(), vehicle_number: "", invoice_reference: "", remarks: "" });
      setQuantities({});
      navigate({ to: "/inventory/delivery-challans/$id", params: { id } });
    },
    onError: error => toast.error(errMsg(error)),
  });

  const visible = (register.data ?? []).filter(x => [x.challan_number, x.purchase_orders?.po_number, x.vendors?.company_name, x.projects?.name]
    .some(value => value?.toLowerCase().includes(searchText.trim().toLowerCase())));
  const paginated = visible.slice(page * PAGE, (page + 1) * PAGE);

  return <>
    <PageHeader title="Vendor Delivery Challans" subtitle="Register what the supplier dispatched before the site records and posts a GRN. Registering a challan never adds stock."
      actions={can("grn.create") && <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Register challan</Button>} />
    <div className="mb-3 flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      <Search className="h-4 w-4 text-muted-foreground" />
      <Input className="h-8 border-0 shadow-none focus-visible:ring-0" aria-label="Search delivery challans" placeholder="Search challan, PO, vendor or project" value={searchText} onChange={e => { setSearchText(e.target.value); setPage(0); }} />
    </div>
    {register.isLoading ? <Loading /> : register.error ? <p className="text-sm text-destructive">{errMsg(register.error)}</p> :
      !visible.length ? <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground"><Truck className="mx-auto mb-3 h-7 w-7" />No delivery challans found.</div> :
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground"><tr>
            <th className="p-3">Vendor challan</th><th className="p-3">Date</th><th className="p-3">PO</th><th className="p-3">Vendor</th><th className="p-3">Project</th><th className="p-3">Status</th><th className="p-3 text-right">Lines</th>
          </tr></thead>
          <tbody>{paginated.map(x => <tr key={x.id} className="border-b last:border-0 hover:bg-muted/40">
            <td className="p-3 font-medium"><Link className="text-primary hover:underline" to="/inventory/delivery-challans/$id" params={{ id: x.id }}>{x.challan_number}</Link></td>
            <td className="p-3">{fmtDate(x.challan_date)}</td>
            <td className="p-3"><Link className="text-primary hover:underline" to="/procurement/purchase-orders/$id" params={{ id: x.po_id }}>{x.purchase_orders?.po_number}</Link></td>
            <td className="p-3">{x.vendors?.company_name}</td><td className="p-3">{x.projects?.name}</td>
            <td className="p-3"><span className={x.status === "registered" ? "text-green-700 dark:text-green-400" : "text-destructive"}>{x.status === "registered" ? "Registered" : "Cancelled"}</span></td>
            <td className="p-3 text-right">{x.vendor_delivery_challan_items?.length ?? 0}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    <Pager page={page} total={visible.length} size={PAGE} onPage={setPage} />

    {open && <Dialog open onOpenChange={value => { if (!value && !create.isPending) setOpen(false); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Register supplier delivery challan</DialogTitle>
          <DialogDescription>Record the vendor's actual document number and dispatched quantities against an approved PO. Receive goods separately after physical inspection.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Purchase order *"><select className={selectCls} value={poId} onChange={e => { setPoId(e.target.value); setQuantities({}); }}>
            <option value="">Choose approved PO</option>
            {pos.data?.map(x => <option key={x.id} value={x.id}>{x.po_number} · {x.vendors?.company_name} · {x.projects?.name}</option>)}
          </select></Field>
          <Field label="Vendor challan number *"><Input maxLength={100} value={h.challan_number} onChange={e => setH({ ...h, challan_number: e.target.value })} placeholder="Supplier's document number" /></Field>
          <Field label="Challan date *"><Input type="date" max={todayIst()} value={h.challan_date} onChange={e => setH({ ...h, challan_date: e.target.value })} /></Field>
          <Field label="Vehicle number"><Input value={h.vehicle_number} onChange={e => setH({ ...h, vehicle_number: e.target.value })} /></Field>
          <Field label="Vendor invoice reference"><Input value={h.invoice_reference} onChange={e => setH({ ...h, invoice_reference: e.target.value })} /></Field>
          <Field label="Notes"><Textarea value={h.remarks} onChange={e => setH({ ...h, remarks: e.target.value })} rows={2} /></Field>
        </div>
        {poId && <div className="overflow-x-auto rounded-md border">
          {items.isLoading ? <Loading /> : items.error ? <p className="p-3 text-sm text-destructive">{errMsg(items.error)}</p> :
            <table className="w-full text-sm"><thead className="border-b bg-muted/40 text-xs"><tr><th className="p-2 text-left">Material</th><th className="p-2 text-right">Ordered</th><th className="p-2 text-right">Dispatch quantity *</th></tr></thead>
              <tbody>{items.data?.map(x => <tr className="border-b last:border-0" key={x.id}>
                <td className="p-2">{x.items?.name} <span className="text-xs text-muted-foreground">({x.items?.code})</span></td>
                <td className="p-2 text-right tabular-nums">{num(x.ordered_quantity)} {x.units_of_measure?.code}</td>
                <td className="p-2"><Input className="ml-auto h-9 w-32 text-right" inputMode="decimal" type="number" min={0} max={x.ordered_quantity} step="0.001" aria-label={`Dispatch quantity for ${x.items?.name}`} placeholder="0" value={quantities[x.id] ?? ""} onChange={e => setQuantities({ ...quantities, [x.id]: e.target.value })} /></td>
              </tr>)}</tbody>
            </table>}
        </div>}
        <p className="text-xs text-muted-foreground">Registering a vendor challan records dispatch evidence only. It does not increase physical stock or create a payable.</p>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>Cancel</Button><Button disabled={create.isPending || items.isLoading} onClick={() => create.mutate()}>Register delivery challan</Button></DialogFooter>
      </DialogContent>
    </Dialog>}
  </>;
}
