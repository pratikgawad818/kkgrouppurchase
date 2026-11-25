import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useCan,useMe } from "@/lib/session";
import { inr,fmtDate } from "@/lib/format";
import { loadPendingOpeningAmendments } from "@/lib/opening-payment-amendments";

export function OpeningPaymentReviewQueue({compact=false}:{compact?:boolean}) {
  const me=useMe();const can=useCan();
  const userId=me.data?.profile.id??"";
  const manager=!!me.data?.roles.some(r=>r==="super_admin"||r==="accounts_manager");
  const allowed=manager&&can("vendor_invoice.view")&&(can("vendor_invoice.create")||can("vendor_invoice.approve"));
  const [page,setPage]=useState(0);
  const q=useQuery({
    queryKey:["opening-payment-review-queue",userId],
    enabled:!!userId&&allowed,staleTime:15_000,refetchOnWindowFocus:true,
    queryFn:()=>loadPendingOpeningAmendments(),
  });
  if(!allowed)return null;
  const rows=q.data??[];
  const actionable=rows.filter(r=>r.requested_by!==userId&&can("vendor_invoice.approve"));
  const size=compact?3:10;
  const shownPage=compact?0:Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1));
  return <section aria-label="Historical payment reviews" className="mb-4 rounded-xl border bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="font-semibold">Historical payment reviews</h2><p className="text-xs text-muted-foreground">Pending corrections hold new invoice settlements until independently reviewed.</p></div>
      <Button size="sm" variant="outline" onClick={()=>void q.refetch()} disabled={q.isFetching}>Refresh</Button>
    </div>
    {q.isError?<p role="alert" className="mt-3 text-sm text-destructive">Pending corrections could not be verified. Refresh to retry.</p>:
      q.isPending?<p role="status" className="mt-3 text-sm text-muted-foreground">Checking pending corrections…</p>:
      <>
        <p className="mt-3 text-sm"><strong>{rows.length}</strong> pending · <strong>{actionable.length}</strong> for your review</p>
        {rows.length===0?<p className="mt-1 text-xs text-muted-foreground">No historical payment corrections awaiting review.</p>:
        <div className="mt-2 divide-y">{rows.slice(shownPage*size,(shownPage+1)*size).map(row=>
          <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <div className="min-w-0"><Link className="font-medium text-primary hover:underline" to="/finance/vendor-invoices/$id" params={{id:row.invoice_id}}>{row.vendor_invoices?.invoice_number??"Open invoice"}</Link>
            <p className="break-words text-xs text-muted-foreground">{row.vendor_invoices?.vendors?.company_name??"Supplier"} · {row.vendor_invoices?.projects?.name??"Project"} · {fmtDate(row.requested_at.slice(0,10))}</p></div>
            <div className="text-right"><strong className="tabular-nums">{inr(row.amount)}</strong><p className="text-xs text-muted-foreground">{row.requested_by===userId?"Awaiting another reviewer":can("vendor_invoice.approve")?"Ready for your review":"Awaiting review"}</p></div>
          </div>)}</div>}
        {compact&&rows.length>size&&<Link to="/finance/vendor-invoices" className="mt-2 inline-block text-sm font-medium text-primary underline">View all pending corrections in Vendor Invoices</Link>}
        {!compact&&rows.length>size&&<div className="mt-2 flex items-center justify-end gap-2 text-xs"><Button size="sm" variant="outline" disabled={shownPage===0} onClick={()=>setPage(shownPage-1)}>Previous</Button><span>Page {shownPage+1} of {Math.ceil(rows.length/size)}</span><Button size="sm" variant="outline" disabled={(shownPage+1)*size>=rows.length} onClick={()=>setPage(shownPage+1)}>Next</Button></div>}
      </>}
  </section>;
}
