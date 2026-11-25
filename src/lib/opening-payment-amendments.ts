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

export type LedgerOpeningInvoice = {
  id:string; invoice_number:string; vendor_invoice_number:string; vendor_invoice_date:string;
  net_payable:number; tds_amount:number; status:string; is_opening:boolean; opening_legacy_paid:number;
  opening_vendor_invoice_prior_payments:{id:string;amount:number}[];
  opening_payment_amendments:{id:string;amount:number;status:string;posting_date:string|null;prior_payment_id:string|null}[];
};
/** Both historical rows and amendment links are read in one nested invoice query,
 * so the ledger does not combine different versions of the same invoice. */
export function loadLedgerInvoices(vendorId:string) {
  return loadCompleteRows<LedgerOpeningInvoice>(async(start,end)=>await db.from("vendor_invoices")
    .select("id,invoice_number,vendor_invoice_number,vendor_invoice_date,net_payable,tds_amount,status,is_opening,opening_legacy_paid,opening_vendor_invoice_prior_payments(id,amount),opening_payment_amendments(id,amount,status,posting_date,prior_payment_id)",{count:"exact"})
    .eq("vendor_id",vendorId).in("status",["approved","partially_paid","paid"]).order("id").range(start,end));
}

export type PendingOpeningAmendment = Pick<OpeningPaymentAmendment,"id"|"invoice_id"|"vendor_id"|"amount"|"requested_by"|"requested_at"> & {
  vendor_invoices: {invoice_number:string;vendor_invoice_number:string;vendors:{company_name:string}|null;projects:{name:string}|null}|null;
};
export function loadPendingOpeningAmendments(vendorId?:string) {
  return loadCompleteRows<PendingOpeningAmendment>(async(start,end)=>{
    let q=db.from("opening_payment_amendments")
      .select("id,invoice_id,vendor_id,amount,requested_by,requested_at,vendor_invoices(invoice_number,vendor_invoice_number,vendors(company_name),projects(name))",{count:"exact"})
      .eq("status","pending");
    if(vendorId)q=q.eq("vendor_id",vendorId);
    return await q.order("requested_at").order("id").range(start,end);
  });
}
