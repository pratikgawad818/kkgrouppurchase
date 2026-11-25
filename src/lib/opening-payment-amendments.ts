import { supabase } from "@/integrations/supabase/client";
import { loadCompleteRows } from "@/lib/complete-register";

export type OpeningPaymentAmendment = {
  id:string; invoice_id:string; vendor_id:string; amount:number; payment_date:string;
  payment_mode:string; reference:string; reason:string; requested_by:string; requested_at:string;
  status:"pending"|"approved"|"rejected"; reviewed_by:string|null; reviewed_at:string|null;
  review_note:string|null; posting_date:string|null; prior_payment_id:string|null;
  journal_entry_id:string|null;
};
// Migration 0118 schema; replace this compatibility shim when generated types are refreshed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const fields="id,invoice_id,vendor_id,amount,payment_date,payment_mode,reference,reason,requested_by,requested_at,status,reviewed_by,reviewed_at,review_note,posting_date,prior_payment_id,journal_entry_id";
export function loadOpeningAmendments(scope:{invoiceId:string}|{vendorId:string}) {
  return loadCompleteRows<OpeningPaymentAmendment>(async(start,end)=>{
    let query=db.from("opening_payment_amendments").select(fields,{count:"exact"});
    query="invoiceId" in scope ? query.eq("invoice_id",scope.invoiceId) : query.eq("vendor_id",scope.vendorId).eq("status","approved");
    return await query.order("id").range(start,end);
  });
}
export async function requestOpeningAmendment(args:{invoiceId:string; updatedAt:string; amount:number; paymentDate:string; mode:string; reference:string; reason:string}) {
  const {error}=await db.rpc("request_opening_payment_amendment",{
    _invoice_id:args.invoiceId,_expected_updated_at:args.updatedAt,_amount:args.amount,
    _payment_date:args.paymentDate,_payment_mode:args.mode,_reference:args.reference,_reason:args.reason,
  });
  if(error)throw error;
}
export async function reviewOpeningAmendment(id:string,decision:"approve"|"reject",note:string) {
  const {error}=await db.rpc("review_opening_payment_amendment",{_id:id,_decision:decision,_note:note});
  if(error)throw error;
}
