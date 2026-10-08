import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PackagePlus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCan } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loading, PageHeader } from "@/components/erp/common";
import { errMsg, fmtDate, inr, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/_shell/inventory/material-issues/$id")({
  head: () => ({ meta: [{ title: "Material Issue & Returns — KK GROUP ERP" }] }),
  component: IssueDetail,
});

function IssueDetail() {
  const { id } = Route.useParams();
  const can = useCan();
  const qc = useQueryClient();
  const [showReturn, setShowReturn] = useState(false);
  const [returnedBy, setReturnedBy] = useState("");
  const [reason, setReason] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: ["material-issue", id],
    queryFn: async () => {
      const [issue, returns] = await Promise.all([
        supabase.from("material_issues").select("*,projects(name),buildings(name),warehouses(name),material_issue_items(id,material_id,quantity,unit_cost,total_cost,items(name,code,units_of_measure(code)))").eq("id", id).single(),
        supabase.from("material_returns").select("id,return_number,return_date,returned_by,reason,material_return_items(issue_item_id,quantity,total_cost)").eq("issue_id", id).order("created_at", { ascending: false }),
      ]);
      if (issue.error) throw issue.error;
      if (returns.error) throw returns.error;
      return { issue: issue.data, returns: returns.data ?? [] };
    },
  });
  const record = useMutation({
    mutationFn: async () => {
      const rows = q.data?.issue.material_issue_items ?? [];
      const prior = q.data?.returns ?? [];
      const items = rows.flatMap(x => {
        const raw = values[x.id];
        if (!raw || raw.trim() === "") return [];
        const qty = Number(raw);
        const used = prior.flatMap(r=>r.material_return_items ?? [])
          .filter(r=>r.issue_item_id === x.id)
          .reduce((sum,r)=>sum+Number(r.quantity),0);
        const available = Math.max(0, Number(x.quantity) - used);
        if (!Number.isFinite(qty) || qty<=0 || qty>available || Math.abs(qty*1000-Math.round(qty*1000))>1e-6)
          throw new Error(`Invalid return quantity for ${x.items?.name}. Maximum ${num(available)}`);
        return [{ issue_item_id: x.id, quantity: qty }];
      });
      if (!returnedBy.trim() || !reason.trim()) throw new Error("Enter who is returning the materials and the return reason.");
      if (!items.length) throw new Error("Enter a positive return quantity for at least one material.");
      const { error } = await supabase.rpc("record_material_return", {
        _issue_id: id, _returned_by: returnedBy.trim(), _reason: reason.trim(), _items: items,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Material return posted; stock restored at original issue cost");
      ["material-issue","material-issues","project-material-consumption","stock","stock-ledger"].forEach(key=>qc.invalidateQueries({queryKey:[key]}));
      setShowReturn(false);setValues({});setReason("");setReturnedBy("");
    },
    onError: error=>toast.error(errMsg(error)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="rounded-xl border p-4 text-sm text-destructive">{errMsg(q.error)}</div>;
  if (!q.data) return null;
  const { issue, returns } = q.data;
  const returnedQty = new Map<string,number>();
  for (const r of returns) for (const line of r.material_return_items ?? [])
    returnedQty.set(line.issue_item_id,(returnedQty.get(line.issue_item_id)??0)+Number(line.quantity));
  const lines = issue.material_issue_items ?? [];
  const gross = lines.reduce((sum,x)=>sum+Number(x.total_cost),0);
  const returnedValue = returns.reduce((sum,r)=>sum+(r.material_return_items ?? []).reduce((v,x)=>v+Number(x.total_cost),0),0);
  const available = lines.some(x=>Number(x.quantity) - (returnedQty.get(x.id)??0)>0);

  return <div className="mx-auto max-w-5xl pb-16">
    <PageHeader title={issue.issue_number} crumbs={<Link to="/inventory/material-issues" className="hover:underline">Material Issues</Link>}
      subtitle="Posted stock issue · original issue lines are immutable"
      actions={can("inventory.return") && available && <Button size="sm" onClick={()=>setShowReturn(true)}><Undo2 className="mr-1 h-4 w-4" />Return unused materials</Button>} />
    <section className="grid grid-cols-2 gap-4 rounded-xl border bg-card p-4 text-sm shadow-card sm:p-5 lg:grid-cols-4">
      <div><p className="text-xs text-muted-foreground">Project / building</p><p className="font-semibold">{issue.projects?.name}{issue.buildings?.name ? ` / ${issue.buildings.name}` : ""}</p></div>
      <div><p className="text-xs text-muted-foreground">Source store</p><p className="font-semibold">{issue.warehouses?.name}</p></div>
      <div><p className="text-xs text-muted-foreground">Issue date</p><p className="font-semibold">{fmtDate(issue.issue_date)}</p></div>
      <div><p className="text-xs text-muted-foreground">Issued to</p><p className="font-semibold">{issue.issued_to}</p></div>
      <div className="sm:col-span-2 lg:col-span-4"><p className="text-xs text-muted-foreground">Purpose / work reference</p><p>{issue.purpose}</p></div>
    </section>
    <section className="mt-4 grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Issued value</p><p className="text-xl font-semibold">{inr(gross)}</p></div>
      <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Returned credit</p><p className="text-xl font-semibold">{inr(returnedValue)}</p></div>
      <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Net project consumption</p><p className="text-xl font-semibold">{inr(gross-returnedValue)}</p></div>
    </section>
    <section className="mt-5 rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="mb-3 font-semibold">Materials issued and returned</h2>
      <div className="doc-table overflow-x-auto"><table className="w-full text-sm sm:min-w-[600px]">
        <thead className="border-b bg-muted/30 text-xs"><tr>
          <th className="p-2 text-left">Material</th><th className="p-2 text-right">Issued</th><th className="p-2 text-right">Returned</th><th className="p-2 text-right">Net used</th><th className="p-2 text-right">Issue unit cost</th><th className="p-2 text-right">Net cost</th>
        </tr></thead>
        <tbody>{lines.map(x=>{
          const back=returnedQty.get(x.id)??0, used=Math.max(0,Number(x.quantity)-back);
          return <tr key={x.id} className="border-b last:border-0">
            <td className="p-2">{x.items?.name} <span className="text-xs text-muted-foreground">{x.items?.code}</span></td>
            <td className="p-2 text-right">{num(x.quantity)} {x.items?.units_of_measure?.code}</td>
            <td className="p-2 text-right">{num(back)}</td>
            <td className="p-2 text-right font-medium">{num(used)}</td>
            <td className="p-2 text-right">{inr(x.unit_cost)}</td>
            <td className="p-2 text-right font-medium">{inr(Number(x.total_cost)-returns.flatMap(r=>r.material_return_items??[]).filter(y=>y.issue_item_id===x.id).reduce((a,y)=>a+Number(y.total_cost),0))}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>
    <section className="mt-5 rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="mb-3 font-semibold">Return history</h2>
      {!returns.length ? <p className="text-sm text-muted-foreground">No returns recorded. Return unused materials to the original store when received.</p> :
      <div className="space-y-2">{returns.map(r=><div key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm">
        <div><div className="font-semibold">{r.return_number}</div>
          <p className="text-xs text-muted-foreground">{fmtDate(r.return_date)} · {r.returned_by} · {r.reason}</p></div>
        <div className="font-semibold">{inr((r.material_return_items??[]).reduce((sum,x)=>sum+Number(x.total_cost),0))}</div>
      </div>)}</div>}
    </section>

    <Dialog open={showReturn} onOpenChange={open=>!record.isPending&&setShowReturn(open)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Return unused materials</DialogTitle>
          <DialogDescription>Returns go only to the original issue store. Each posting adds a source-linked return entry to the permanent stock ledger.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="return-person" className="text-sm font-medium">Returned by *</label>
            <Input id="return-person" maxLength={120} value={returnedBy} onChange={e=>setReturnedBy(e.target.value)} placeholder="Person handing materials back" /></div>
          <div><label htmlFor="return-reason" className="text-sm font-medium">Reason *</label>
            <Input id="return-reason" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. surplus after slab casting" /></div>
        </div>
        <div className="doc-table max-h-72 overflow-y-auto rounded-md border max-sm:max-h-none">
          <table className="w-full text-sm"><thead className="border-b bg-muted/50 text-xs"><tr><th className="p-2 text-left">Material</th><th className="p-2 text-right">Can return</th><th className="p-2 text-right">Quantity</th></tr></thead>
            <tbody>{lines.map(x=>{
              const remaining=Math.max(0,Number(x.quantity)-(returnedQty.get(x.id)??0));
              if(remaining<=0)return null;
              return <tr key={x.id} className="border-b last:border-0"><td className="p-2">{x.items?.name}</td>
                <td className="p-2 text-right tabular-nums">{num(remaining)} {x.items?.units_of_measure?.code}</td>
                <td className="p-2"><Input className="ml-auto h-9 w-28 text-right" type="number" inputMode="decimal" min={0} max={remaining} step="0.001"
                  value={values[x.id]??""} onChange={e=>setValues({...values,[x.id]:e.target.value})}
                  aria-label={`Return quantity of ${x.items?.name}`} placeholder="0" /></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground"><PackagePlus className="mr-1 inline h-4 w-4" />Each return reverses project consumption at the original issue cost and increases store stock using weighted-average inventory valuation.</p>
        <DialogFooter><Button variant="outline" disabled={record.isPending} onClick={()=>setShowReturn(false)}>Cancel</Button>
          <Button disabled={record.isPending} onClick={()=> {if(window.confirm("Post this return and restore stock? It cannot be edited later."))record.mutate();}}>Post return</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
