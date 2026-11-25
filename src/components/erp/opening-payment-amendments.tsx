import { useState } from "react";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/erp/common";
import { errMsg,fmtDate,inr } from "@/lib/format";
import { useCan,useMe } from "@/lib/session";
import { selectCls } from "@/lib/po";
import { loadOpeningAmendments,requestOpeningAmendment,reviewOpeningAmendment,type OpeningPaymentAmendment } from "@/lib/opening-payment-amendments";

type Bill={id:string; vendor_id:string; status:string; balance_due:number; vendor_invoice_date:string; updated_at:string; opening_legacy_paid:number};
const modes=["neft","rtgs","imps","cheque","upi","cash","card","other"];
const empty={amount:"",paymentDate:"",mode:"",reference:"",reason:""};
export function OpeningPaymentAmendments({invoice}:{invoice:Bill}) {
  const me=useMe();const can=useCan();const qc=useQueryClient();
  const userId=me.data?.profile.id??"";
  const manager=!!me.data?.roles.some(r=>r==="super_admin"||r==="accounts_manager");
  const canRequest=manager&&can("vendor_invoice.create");
  const canReview=manager&&can("vendor_invoice.approve");
  const [form,setForm]=useState(empty);
  const [open,setOpen]=useState(false);
  const [review,setReview]=useState<{row:OpeningPaymentAmendment;decision:"approve"|"reject"}|null>(null);
  const [note,setNote]=useState("");
  const [verified,setVerified]=useState(false);
  const q=useQuery({queryKey:["opening-payment-amendments",invoice.id,userId],enabled:!!userId,
    queryFn:()=>loadOpeningAmendments({invoiceId:invoice.id})});
  const refresh=async()=>{
    await Promise.all([qc.invalidateQueries({queryKey:["opening-payment-amendments",invoice.id]}),
      qc.invalidateQueries({queryKey:["vi",invoice.id]}),qc.invalidateQueries({queryKey:["vendor-invoices"]}),
      qc.invalidateQueries({queryKey:["ledger",invoice.vendor_id]}),qc.invalidateQueries({queryKey:["accounts-task-queue"]}),
      qc.invalidateQueries({queryKey:["payables"]}),qc.invalidateQueries({queryKey:["payment-invoices"]}),qc.invalidateQueries({queryKey:["pay-open"]}),qc.invalidateQueries({queryKey:["opening-payment-review-queue"]})]);
  };
  const request=useMutation({mutationFn:async()=>{
    if(!canRequest||!verified)throw new Error("Verify the original payment before requesting correction.");
    await requestOpeningAmendment({invoiceId:invoice.id,updatedAt:invoice.updated_at,amount:Number(form.amount),
      paymentDate:form.paymentDate,mode:form.mode,reference:form.reference,reason:form.reason});
  },onSuccess:async()=>{setOpen(false);setForm(empty);setVerified(false);await refresh();toast.success("Historical correction requested for independent review.");},
    onError:e=>toast.error(errMsg(e))});
  const decide=useMutation({mutationFn:async()=>{
    if(!review||!canReview||review.row.requested_by===userId||(review.decision==="approve"&&!verified))
      throw new Error("Independent review is required.");
    await reviewOpeningAmendment(review.row.id,review.decision,note);
  },onSuccess:async()=>{setReview(null);setNote("");setVerified(false);await refresh();toast.success("Correction review saved.");},
    onError:e=>toast.error(errMsg(e))});
  const pending=q.data?.some(r=>r.status==="pending");
  const eligible=["approved","partially_paid"].includes(invoice.status)&&Number(invoice.balance_due)>0&&Number(invoice.opening_legacy_paid)===0;
  const amount=Number(form.amount);
  const valid=verified&&Number.isFinite(amount)&&amount>0&&amount<=Number(invoice.balance_due)&&
    !!form.paymentDate&&!!form.mode&&form.reference.trim().length>=3&&form.reason.trim().length>=10;
  const set=(key:keyof typeof empty,value:string)=>setForm(prev=>({...prev,[key]:value}));
  if(!["approved","partially_paid","paid"].includes(invoice.status))return null;
  return <section className="mt-4 rounded-xl border bg-card p-4 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-semibold">Historical payment corrections</h2>
      <p className="mt-1 text-xs text-muted-foreground">For documented payments made before ERP entry but omitted from this bill. Never use this to pay a supplier today. Approved corrections reduce the opening liability without another bank transaction.</p></div>
      {canRequest&&eligible&&q.isSuccess&&!pending&&<Button size="sm" variant="outline" onClick={()=>{setForm(empty);setVerified(false);setOpen(true);}}>Add missed historical payment</Button>}
    </div>
    {q.isError?<p role="alert" className="mt-3 text-destructive">Unable to verify corrections. <button type="button" className="underline" onClick={()=>void q.refetch()}>Retry</button></p>:
      q.isPending?<p className="mt-3 text-muted-foreground">Checking corrections…</p>:
      !q.data?.length?<p className="mt-3 text-muted-foreground">No historical corrections requested.</p>:
      <div className="mt-3 space-y-3">{[...q.data].sort((a,b)=>b.requested_at.localeCompare(a.requested_at)).map(row=>
        <article key={row.id} className="rounded-lg border p-3">
          <div className="flex justify-between gap-2"><strong>{inr(row.amount)} · {fmtDate(row.payment_date)}</strong><span className="capitalize">{row.status}</span></div>
          <p className="mt-1 break-words text-xs">{row.payment_mode.toUpperCase()} · {row.reference}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{row.reason}</p>
          {row.review_note&&<p className="mt-1 break-words text-xs">Review: {row.review_note}{row.posting_date?" · Posted "+fmtDate(row.posting_date):""}</p>}
          {row.status==="pending"&&canReview&&row.requested_by!==userId&&<div className="mt-2 flex gap-2">
            <Button size="sm" onClick={()=>{setReview({row,decision:"approve"});setNote("");setVerified(false);}}>Review & approve</Button>
            <Button size="sm" variant="outline" onClick={()=>{setReview({row,decision:"reject"});setNote("");setVerified(false);}}>Reject</Button></div>}
          {row.status==="pending"&&row.requested_by===userId&&<p className="mt-2 text-xs text-muted-foreground">Awaiting another authorized reviewer.</p>}
        </article>)}</div>}
    {canRequest&&Number(invoice.opening_legacy_paid)>0&&<p className="mt-2 text-xs text-muted-foreground">This bill has an aggregate legacy-paid amount; reconcile its original documentation before requesting an additional correction.</p>}
    <Dialog open={open} onOpenChange={v=>{if(!request.isPending)setOpen(v);}}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Request historical payment correction</DialogTitle><DialogDescription>Current balance: {inr(invoice.balance_due)}. Independent review is required before any adjustment.</DialogDescription></DialogHeader>
        <form className="space-y-3" onSubmit={e=>{e.preventDefault();if(valid)request.mutate();}}>
          <fieldset disabled={request.isPending} className="space-y-3">
          <Field label="Amount already paid"><Input required type="number" min="0.01" step="0.01" max={invoice.balance_due} value={form.amount} onChange={e=>set("amount",e.target.value)}/></Field>
          <Field label="Original payment date"><Input required type="date" min={invoice.vendor_invoice_date} value={form.paymentDate} onChange={e=>set("paymentDate",e.target.value)}/></Field>
          <Field label="Payment method"><select required className={selectCls} value={form.mode} onChange={e=>set("mode",e.target.value)}><option value="">Select method</option>{modes.map(mode=><option key={mode} value={mode}>{mode.toUpperCase()}</option>)}</select></Field>
          <Field label="Original bank / cheque / cash voucher reference"><Input required minLength={3} maxLength={150} value={form.reference} onChange={e=>set("reference",e.target.value)}/></Field>
          <Field label="Correction reason and proof details"><Textarea required minLength={10} maxLength={500} rows={3} value={form.reason} onChange={e=>set("reason",e.target.value)}/></Field>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/> I checked the original payment proof and confirmed that this amount was not recorded in ERP or already included in the opening balance.</label>
          <DialogFooter><Button type="button" variant="outline" onClick={()=>setOpen(false)}>Cancel</Button><Button type="submit" disabled={!valid||request.isPending}>Send for review</Button></DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={!!review} onOpenChange={v=>{if(!v&&!decide.isPending)setReview(null);}}>
      <DialogContent><DialogHeader><DialogTitle>{review?.decision==="approve"?"Approve historical correction":"Reject historical correction"}</DialogTitle><DialogDescription>{review&&inr(review.row.amount)} · {review?.row.reference}. Approval posts a current-period adjustment, not a cash or bank payment.</DialogDescription></DialogHeader>
        <p className="text-sm break-words">{review?.row.reason}</p>
        <Field label="Independent review reason"><Textarea rows={3} minLength={10} maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></Field>
        {review?.decision==="approve"&&<label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/> I independently verified the original proof and checked for duplicate settlement.</label>}
        <DialogFooter><Button variant="outline" disabled={decide.isPending} onClick={()=>setReview(null)}>Cancel</Button><Button disabled={decide.isPending||note.trim().length<10||(review?.decision==="approve"&&!verified)} onClick={()=>decide.mutate()}>Confirm {review?.decision}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
