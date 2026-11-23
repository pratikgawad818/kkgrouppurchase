import { useQuery } from "@tanstack/react-query";
import { Check, Clock3, FileText, Truck, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { errMsg } from "@/lib/format";
import { sitePrMilestones, type SitePr } from "@/lib/site-engineer-pr-milestones";
import { cn } from "@/lib/utils";

/**
 * PR-level view combines all vendor POs, challans and GRNs for one PR.
 * Queries use linked UUIDs and respect existing RLS/project access. The
 * original requester gets transition notifications; other engineers working
 * on the same assigned project are never subscribed to those notifications.
 */
export function SiteEngineerPrTracker({
  pr, receivedBy,
}: {
  pr: SitePr;
  receivedBy?: string | null;
}) {
  const linked = useQuery({
    queryKey: ["site-pr-five-milestones", pr.id],
    staleTime: 15_000,
    refetchOnMount: "always",
    queryFn: async () => {
      const po = await supabase.from("purchase_orders")
        .select("id,po_number,status,purchase_request_id")
        .eq("purchase_request_id",pr.id).order("created_at");
      if (po.error) throw po.error;
      const ids=(po.data ?? []).map((x)=>x.id);
      if (!ids.length) return { pos: [], challans: [], grns: [] };
      const [c,g]=await Promise.all([
        supabase.from("vendor_delivery_challans")
          .select("id,challan_number,status,po_id")
          .in("po_id",ids).order("created_at"),
        supabase.from("goods_receipt_notes")
          .select("id,grn_number,status,po_id")
          .in("po_id",ids).order("created_at"),
      ]);
      if (c.error) throw c.error;
      if (g.error) throw g.error;
      return {
        pos:(po.data ?? []).map(x=>({
          id:x.id,number:x.po_number,status:x.status,prId:x.purchase_request_id,
        })),
        challans:(c.data ?? []).map(x=>({
          id:x.id,number:x.challan_number,status:x.status,poId:x.po_id,
        })),
        grns:(g.data ?? []).map(x=>({
          id:x.id,number:x.grn_number,status:x.status,poId:x.po_id,
        })),
      };
    },
  });
  const journey=linked.data ? sitePrMilestones(pr, {
    prs:[pr], pos:linked.data.pos,
    challans:linked.data.challans,grns:linked.data.grns,
  }) : null;
  const icons=[FileText,Check,ShieldCheck,FileText,Truck];
  return (
    <section className="mt-4 rounded-2xl border bg-card p-4 shadow-card sm:p-5"
      aria-label="Site Engineer five-stage purchase request tracker">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Purchase request progress</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Five milestones from request to physical delivery · {pr.number}
          </p>
        </div>
        <span className="rounded-full border px-2.5 py-1 text-xs font-medium">
          {journey?.completed ? "Goods received" : linked.isLoading ? "Checking progress…" : "In progress"}
        </span>
      </div>
      {linked.error && <p role="alert" className="mt-3 text-sm text-destructive">
        Could not load linked POs and receipts: {errMsg(linked.error)}
      </p>}
      {journey && (
        <>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {journey.stages.map((stage,i)=>{
              const Icon=icons[i]!;
              return <li key={stage.key} className={cn(
                "min-w-0 rounded-xl border p-3",
                stage.state==="current" && "border-primary/60 bg-primary/5",
                stage.state==="done" && "bg-muted/30",
              )}>
                <div className="flex items-center gap-2">
                  <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs",
                    stage.state==="done" && "bg-primary text-primary-foreground",
                    stage.state==="current" && "border-primary text-primary")}>
                    {stage.state==="done" ? <Check className="h-3.5 w-3.5" aria-hidden />
                      : stage.state==="current" ? <Clock3 className="h-3.5 w-3.5" aria-hidden />
                        : <Icon className="h-3.5 w-3.5" aria-hidden />}
                  </span>
                  <span className="text-[11px] text-muted-foreground">Step {i+1}</span>
                </div>
                <p className="mt-2 text-xs font-semibold leading-5">{stage.label}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {stage.state==="done" ? "Completed"
                    : stage.state==="current" ? "Current / awaiting action" : "Upcoming"}
                </p>
                {i===1 && stage.state==="done" && receivedBy &&
                  <p className="mt-1 break-words text-[11px] text-muted-foreground">By {receivedBy}</p>}
                {i===2 && stage.state==="done" &&
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Director approval recorded
                  </p>}
                {stage.documents.length>0 &&
                  <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                    {stage.documents.map((doc,j)=>
                      <a key={doc.href+j} href={doc.href} title={doc.number}
                        className="max-w-full truncate rounded-md border px-1.5 py-1 text-[11px] text-primary hover:underline">
                        {doc.number}
                      </a>)}
                  </div>}
              </li>;
            })}
          </ol>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 p-3">
            <p className="min-w-0 text-xs font-medium">{journey.stage}</p>
            <a href={journey.href} className="rounded-lg border bg-background px-3 py-2 text-xs font-semibold text-primary hover:bg-muted">
              {journey.action}
            </a>
          </div>
        </>
      )}
      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
        Each PO can have multiple delivery challans and GRNs. A first or draft
        receipt does not mean all goods have arrived. Stage alerts go only to
        the original Site Engineer who submitted this PR; phone alerts must be
        enabled from Notifications.
      </p>
    </section>
  );
}
