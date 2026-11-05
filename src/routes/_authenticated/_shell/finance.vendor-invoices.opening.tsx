import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus, Trash2, FileText, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, Loading, PageHeader } from "@/components/erp/common";
import { errMsg, inr } from "@/lib/format";
import { selectCls } from "@/lib/po";
import { PAYMENT_MODES, today, uploadVendorDoc } from "@/lib/finance";
import { cn } from "@/lib/utils";
import {
  evaluateOpeningBill, isRealDate, newHistoricPayment, newOpeningLine,
  type OpeningGST, type OpeningLine, type HistoricPayment,
} from "@/lib/opening-bills";

const META = "Itemized historical vendor bills and payments made before KK ERP.";
export const Route = createFileRoute("/_authenticated/_shell/finance/vendor-invoices/opening")({
  head: () => ({ meta: [{ title: "Old Vendor Bill — KK GROUP ERP" }, { name: "description", content: META }] }),
  validateSearch: (raw: Record<string, unknown>): { id?: string } =>
    typeof raw['id'] === "string" ? { id: raw['id'] } : {},
  component: OpeningBill,
});

type Header = {
  vendor_id: string; project_id: string; building_id: string; vendor_invoice_number: string;
  vendor_invoice_date: string; due_date: string; gst_type: OpeningGST;
  freight: string; other_charges: string; tds_section: string; tds_rate: string; remarks: string;
};
const initial: Header = {
  vendor_id: "", project_id: "", building_id: "", vendor_invoice_number: "",
  vendor_invoice_date: today(), due_date: "", gst_type: "cgst_sgst",
  freight: "0", other_charges: "0", tds_section: "", tds_rate: "0", remarks: "",
};
const toStr = (v: string | number | null | undefined, fallback = "") => v == null ? fallback : String(v);
const box = "rounded-xl border bg-card p-4 sm:p-5";

function OpeningBill() {
  const { id: editId } = Route.useSearch();
  const nav = useNavigate(), qc = useQueryClient();
  const [h, setH] = useState<Header>(initial);
  const [lines, setLines] = useState<OpeningLine[]>([newOpeningLine("initial")]);
  const [payments, setPayments] = useState<HistoricPayment[]>([]);
  const [legacyPaid, setLegacyPaid] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const set = (field: keyof Header, value: string) => setH(current => ({ ...current, [field]: value }));
  const changeLine = (id: string, field: keyof OpeningLine, value: string) =>
    setLines(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  const changePayment = (id: string, field: keyof HistoricPayment, value: string) =>
    setPayments(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));

  const base = useQuery({
    queryKey: ["opening-bill-base"],
    queryFn: async () => {
      const [v,p,b] = await Promise.all([
        supabase.from("vendors").select("id,company_name,gstin").order("company_name"),
        supabase.from("projects").select("id,name").order("name"),
        supabase.from("buildings").select("id,name,project_id").order("name"),
      ]);
      if(v.error)throw v.error;
      if(p.error)throw p.error;
      if(b.error)throw b.error;
      return {vendors:v.data ?? [],projects:p.data ?? [],buildings:b.data ?? []};
    },
  });
  const existing = useQuery({
    queryKey: ["opening-bill-edit", editId],
    enabled: !!editId,
    queryFn: async () => {
      const [inv, itemRows, paidRows] = await Promise.all([
        supabase.from("vendor_invoices").select("*").eq("id", editId!).single(),
        supabase.from("opening_vendor_invoice_lines").select("*").eq("invoice_id", editId!).order("line_no"),
        supabase.from("opening_vendor_invoice_prior_payments").select("*").eq("invoice_id", editId!).order("line_no"),
      ]);
      if(inv.error)throw inv.error;
      if(itemRows.error)throw itemRows.error;
      if(paidRows.error)throw paidRows.error;
      if(!inv.data.is_opening)throw new Error("This is not an opening bill. Use the regular invoice editor.");
      return {invoice:inv.data,lines:itemRows.data ?? [],payments:paidRows.data ?? []};
    },
  });
  useEffect(() => {
    const entry = existing.data;
    if(!entry)return;
    const inv=entry.invoice;
    const match = inv.match_summary && typeof inv.match_summary === "object" && !Array.isArray(inv.match_summary)
      ? inv.match_summary : {};
    setH({
      vendor_id:inv.vendor_id,project_id:inv.project_id,building_id:inv.building_id ?? "",
      vendor_invoice_number:inv.vendor_invoice_number,
      vendor_invoice_date:inv.vendor_invoice_date,due_date:inv.due_date ?? "",
      gst_type:(match['gst_type'] === "none" || match['gst_type'] === "igst" || match['gst_type'] === "cgst_sgst")
        ? match['gst_type'] : (Number(inv.igst)>0 ? "igst" : "cgst_sgst"),
      freight:toStr(inv.freight,"0"),other_charges:toStr(inv.other_charges,"0"),
      tds_section:inv.tds_section ?? "",tds_rate:toStr(inv.tds_rate,"0"),remarks:inv.remarks ?? "",
    });
    setLegacyPaid(Number(inv.opening_legacy_paid) || 0);
    setLines(entry.lines.length ? entry.lines.map(row => ({
      id:row.id,description:row.description,hsn_sac:row.hsn_sac ?? "",
      unit:row.unit,quantity:toStr(row.quantity),rate:toStr(row.rate),
      discount:toStr(row.discount),tax_rate:toStr(row.tax_rate),
    })) : [newOpeningLine("initial")]);
    setPayments(entry.payments.map(row => ({
      id:row.id,payment_date:row.payment_date,payment_mode:row.payment_mode,
      reference:row.reference ?? "",amount:toStr(row.amount),remarks:row.remarks ?? "",
    })));
  }, [existing.data]);

  const calc = evaluateOpeningBill({
    lines,payments,gstType:h.gst_type,freight:h.freight,
    otherCharges:h.other_charges,tdsRate:h.tds_rate,legacyPaid,
  });
  const validation = [
    ...calc.errors,
    ...(!h.vendor_id ? ["Select the vendor."] : []),
    ...(!h.project_id ? ["Select the project."] : []),
    ...(h.building_id && !base.data?.buildings.some(b=>b.id===h.building_id && b.project_id===h.project_id)
      ? ["Building does not belong to the selected project."] : []),
    ...(!h.vendor_invoice_number.trim() ? ["Enter the vendor's original bill number."] : []),
    ...(!isRealDate(h.vendor_invoice_date) || h.vendor_invoice_date>today() ? ["Enter a valid historical bill date."] : []),
    ...(h.due_date && (!isRealDate(h.due_date) || h.due_date<h.vendor_invoice_date)
      ? ["Due date must not be earlier than the bill date."] : []),
    ...(payments.some(p=>p.payment_date>today()) ? ["Historical payments cannot be future-dated."] : []),
    ...(editId && existing.data?.invoice.status !== "pending_review"
      ? ["Only pending-review old bills may be edited. Approved bills are locked."] : []),
  ];
  const save = useMutation({
    mutationFn: async () => {
      if(base.error || base.isFetching || existing.error || (editId && (!existing.data || existing.isFetching)))
        throw new Error("Could not verify the vendor, project or existing invoice. Refresh the page.");
      if(validation.length)throw new Error(validation.join(" "));
      const attachment_path=file ? await uploadVendorDoc("invoices",file) : "";
      const payload={
        _id:editId ?? null,
        _header:{...h,attachment_path},
        _lines:lines.map(({description,hsn_sac,unit,quantity,rate,discount,tax_rate})=>({
          description,hsn_sac,unit,quantity,rate,discount,tax_rate,
        })),
        _payments:payments.map(({payment_date,payment_mode,reference,amount,remarks})=>({
          payment_date,payment_mode,reference,amount,remarks,
        })),
      };
      const {data,error}=await supabase.rpc("save_opening_vendor_invoice_v2",payload);
      if(error){
        if(error.message.startsWith("DUPLICATE_INVOICE"))
          throw new Error("This vendor bill is already registered as "+(error.message.split("|")[2] ?? "another invoice")+".");
        throw error;
      }
      return data as string;
    },
    onSuccess:(id)=>{
      toast.success(editId?"Opening bill updated":"Old bill saved for verification");
      void qc.invalidateQueries({queryKey:["vendor-invoices"]});
      void qc.invalidateQueries({queryKey:["vi",id]});
      nav({to:"/finance/vendor-invoices/$id",params:{id}});
    },
    onError:(e)=>toast.error(errMsg(e)),
  });

  if(base.isLoading || (editId && existing.isLoading))return <Loading />;
  if(base.error || existing.error)return <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
    Could not load opening-bill details: {errMsg(base.error || existing.error)}
  </div>;
  const data=base.data!;
  const buildingOptions=data.buildings.filter(b=>b.project_id===h.project_id);
  const canEdit = !editId || existing.data?.invoice.status === "pending_review";
  const canSave = canEdit && !save.isPending && !base.isFetching &&
    (!editId || !existing.isFetching) && validation.length===0;

  return <div className="mx-auto max-w-7xl space-y-5 pb-20">
    <PageHeader title={editId ? "Edit old vendor bill" : "Old vendor bill entry"}
      subtitle="Record each item from an earlier supplier bill and payments that actually happened before ERP."/>
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 dark:bg-sky-950/20 dark:text-sky-100">
      <strong>Historical entry, not a new purchase or payment.</strong> No PO or GRN is required. Previously completed payments are recorded without director payment approval and never create a new bank/cash transaction. Any fresh payment against an outstanding balance still follows the standard approval workflow.
    </div>
    {editId && existing.data?.lines.length===0 && <p className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950">
      This bill was entered using the old amount-only form. Enter the actual bill lines below to itemize it; verify the new total before saving. Previously recorded paid amounts remain preserved.
    </p>}
    {!canEdit && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      Approved old bills cannot be edited. Use a controlled correction with Accounts.
    </p>}
    <form className="space-y-5" onSubmit={e=>{e.preventDefault();if(canSave)save.mutate();}}>
      <section className={box}>
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><FileText className="h-4 w-4"/> Bill information</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Supplier / Vendor *"><select className={selectCls} value={h.vendor_id} disabled={!canEdit || !!editId}
            onChange={e=>set("vendor_id",e.target.value)}><option value="">Select vendor</option>
            {data.vendors.map(v=><option key={v.id} value={v.id}>{v.company_name}</option>)}</select></Field>
          <Field label="Project *"><select className={selectCls} value={h.project_id} disabled={!canEdit || !!editId}
            onChange={e=>setH(v=>({...v,project_id:e.target.value,building_id:""}))}><option value="">Select project</option>
            {data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Building"><select className={selectCls} disabled={!canEdit} value={h.building_id}
            onChange={e=>set("building_id",e.target.value)}><option value="">No specific building</option>
            {buildingOptions.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Supplier's bill number *"><Input disabled={!canEdit} maxLength={100} value={h.vendor_invoice_number}
            onChange={e=>set("vendor_invoice_number",e.target.value)} placeholder="As printed on supplier invoice"/></Field>
          <Field label="Original bill date *"><Input disabled={!canEdit} type="date" max={today()} value={h.vendor_invoice_date}
            onChange={e=>set("vendor_invoice_date",e.target.value)}/></Field>
          <Field label="Due date"><Input disabled={!canEdit} type="date" min={h.vendor_invoice_date} value={h.due_date}
            onChange={e=>set("due_date",e.target.value)}/></Field>
          <Field label="GST treatment"><select disabled={!canEdit} className={selectCls} value={h.gst_type}
            onChange={e=>{const v=e.target.value as OpeningGST;set("gst_type",v);
              if(v==="none")setLines(prev=>prev.map(row=>({...row,tax_rate:"0"})));}}>
            <option value="cgst_sgst">CGST + SGST (intra-state)</option><option value="igst">IGST (inter-state)</option>
            <option value="none">No GST</option></select></Field>
          <Field label="Invoice copy (PDF/image)"><Input disabled={!canEdit} type="file" accept="application/pdf,image/*"
            onChange={e=>setFile(e.target.files?.[0]??null)}/></Field>
        </div>
      </section>

      <section className={box}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-semibold">Item-wise bill details</h2><p className="text-xs text-muted-foreground">Materials, service or labour charges exactly as shown on the original invoice.</p></div>
          <Button type="button" disabled={!canEdit || lines.length>=100} size="sm" variant="outline"
            onClick={()=>setLines(current=>[...current,newOpeningLine(crypto.randomUUID())])}>
            <Plus className="mr-1 h-4 w-4"/>Add item
          </Button>
        </div>
        <div className="doc-table overflow-x-auto rounded-lg border">
          <table className="min-w-[1000px] w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>
              <th className="px-2 py-2">#</th><th className="px-2 py-2">Material / description *</th>
              <th className="px-2 py-2">HSN / SAC</th><th className="px-2 py-2">Unit</th>
              <th className="px-2 py-2">Qty *</th><th className="px-2 py-2">Rate (₹) *</th>
              <th className="px-2 py-2">Discount (₹)</th><th className="px-2 py-2">GST %</th>
              <th className="px-2 py-2 text-right">Taxable</th><th className="px-2 py-2 text-right">Line total</th>
              <th className="px-2 py-2"/>
            </tr></thead>
            <tbody>{lines.map((row,i)=><tr key={row.id} className="border-t">
              <td className="px-2 py-2 text-muted-foreground">{i+1}</td>
              <td className="px-2 py-2"><Input aria-label={"Item "+(i+1)+" description"} disabled={!canEdit}
                className="h-9 min-w-48" value={row.description} maxLength={250}
                onChange={e=>changeLine(row.id,"description",e.target.value)} placeholder="e.g. OPC Cement 53 Grade"/></td>
              <td className="px-2 py-2"><Input aria-label={"Item "+(i+1)+" HSN SAC"} disabled={!canEdit}
                className="h-9 w-28" value={row.hsn_sac} maxLength={30}
                onChange={e=>changeLine(row.id,"hsn_sac",e.target.value)}/></td>
              <td className="px-2 py-2"><Input aria-label={"Item "+(i+1)+" unit"} disabled={!canEdit}
                className="h-9 w-20" maxLength={25} value={row.unit}
                onChange={e=>changeLine(row.id,"unit",e.target.value)}/></td>
              <td className="px-2 py-2"><Input aria-label={"Item "+(i+1)+" quantity"} disabled={!canEdit}
                className="h-9 w-20 text-right" inputMode="decimal" value={row.quantity}
                onChange={e=>changeLine(row.id,"quantity",e.target.value)}/></td>
              <td className="px-2 py-2"><Input aria-label={"Item "+(i+1)+" rate"} disabled={!canEdit}
                className="h-9 w-28 text-right" inputMode="decimal" value={row.rate}
                onChange={e=>changeLine(row.id,"rate",e.target.value)}/></td>
              <td className="px-2 py-2"><Input aria-label={"Item "+(i+1)+" discount"} disabled={!canEdit}
                className="h-9 w-24 text-right" inputMode="decimal" value={row.discount}
                onChange={e=>changeLine(row.id,"discount",e.target.value)}/></td>
              <td className="px-2 py-2"><Input aria-label={"Item "+(i+1)+" GST rate"} disabled={!canEdit || h.gst_type==="none"}
                className="h-9 w-20 text-right" inputMode="decimal" value={row.tax_rate}
                onChange={e=>changeLine(row.id,"tax_rate",e.target.value)}/></td>
              <td className="px-2 py-2 text-right font-mono">{inr(calc.computed[i]?.taxable??0)}</td>
              <td className="px-2 py-2 text-right font-mono font-medium">{inr(calc.computed[i]?.total??0)}</td>
              <td className="px-2 py-2 text-right"><Button type="button" disabled={!canEdit || lines.length===1}
                size="icon" variant="ghost" aria-label={"Remove item "+(i+1)}
                onClick={()=>setLines(prev=>prev.filter(l=>l.id!==row.id))}><Trash2 className="h-4 w-4"/></Button></td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">For opening bills, item rows document historical expenses; they do not add or modify current stock quantities.</p>
      </section>

      <section className={box}>
        <h2 className="mb-3 font-semibold">Additional amounts and deductions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Freight (₹)"><Input disabled={!canEdit} inputMode="decimal" value={h.freight} onChange={e=>set("freight",e.target.value)}/></Field>
          <Field label="Other charges (₹)"><Input disabled={!canEdit} inputMode="decimal" value={h.other_charges} onChange={e=>set("other_charges",e.target.value)}/></Field>
          <Field label="TDS section (if applicable)"><Input disabled={!canEdit} maxLength={30} placeholder="e.g. 194C"
            value={h.tds_section} onChange={e=>set("tds_section",e.target.value)}/></Field>
          <Field label="TDS rate %"><Input disabled={!canEdit} inputMode="decimal" value={h.tds_rate} onChange={e=>set("tds_rate",e.target.value)}/></Field>
        </div>
      </section>

      <section className={box}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="flex items-center gap-2 font-semibold"><ReceiptText className="h-4 w-4"/>Payments already made before ERP</h2>
            <p className="text-xs text-muted-foreground">Historical payment record only. No director payment approval, no new bank debit and no vendor-payment scheduling.</p></div>
          <Button type="button" size="sm" variant="outline" disabled={!canEdit || payments.length>=100}
            onClick={()=>setPayments(prev=>[...prev,newHistoricPayment(crypto.randomUUID(),today())])}>
            <Plus className="mr-1 h-4 w-4"/>Add past payment
          </Button>
        </div>
        {legacyPaid>0 && <div className="mb-3 rounded-lg border p-3 text-sm">
          <span className="font-medium">Historical amount already recorded using the older form: {inr(legacyPaid)}</span>
          <p className="mt-1 text-xs text-muted-foreground">Preserved as a legacy amount, not counted again in the individual payment entries below.</p>
        </div>}
        {payments.length===0 && <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No previous payments recorded. Add past payments only if money was actually paid before entering this bill into KK ERP.</div>}
        <div className="space-y-3">{payments.map((p,i)=><div key={p.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Payment date"><Input disabled={!canEdit} type="date" max={today()} value={p.payment_date}
            onChange={e=>changePayment(p.id,"payment_date",e.target.value)}/></Field>
          <Field label="Payment mode"><select disabled={!canEdit} className={selectCls} value={p.payment_mode}
            onChange={e=>changePayment(p.id,"payment_mode",e.target.value)}>
            {PAYMENT_MODES.map(([code,label])=><option key={code} value={code}>{label}</option>)}
            <option value="card">Card</option></select></Field>
          <Field label="Amount paid (₹)"><Input disabled={!canEdit} inputMode="decimal" value={p.amount}
            onChange={e=>changePayment(p.id,"amount",e.target.value)}/></Field>
          <Field label="UTR / cheque / reference"><Input disabled={!canEdit} maxLength={150} value={p.reference}
            onChange={e=>changePayment(p.id,"reference",e.target.value)}/></Field>
          <Field label="Remarks"><Input disabled={!canEdit} maxLength={500} value={p.remarks}
            onChange={e=>changePayment(p.id,"remarks",e.target.value)}/></Field>
          <div className="flex items-end justify-end">
            <Button type="button" disabled={!canEdit} size="sm" variant="ghost"
              onClick={()=>setPayments(prev=>prev.filter(x=>x.id!==p.id))} aria-label={"Remove prior payment "+(i+1)}>
              <Trash2 className="mr-1 h-4 w-4"/>Remove
            </Button>
          </div>
        </div>)}</div>
      </section>

      <section className={box}>
        <Field label="Internal notes / bill remarks"><Textarea disabled={!canEdit} maxLength={1500} rows={2}
          value={h.remarks} onChange={e=>set("remarks",e.target.value)}
          placeholder="Old supplier bill, construction work, prior settlement details…"/></Field>
      </section>

      <section className={cn(box,"space-y-3")}>
        <h2 className="font-semibold">Bill and outstanding summary</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          {[
            ["Taxable value",calc.subtotal],["GST amount",calc.taxTotal],
            ["Freight + charges",Number(h.freight||0)+Number(h.other_charges||0)],
            ["Gross invoice",calc.gross],["TDS",calc.tds],["Net payable",calc.net],
            ["Already paid (historic)",calc.paid+calc.legacyPaid],["Remaining unpaid",calc.balance],
          ].map(([label,value])=><div key={label as string} className="flex justify-between gap-3 rounded-lg bg-muted/40 p-3">
            <span className="text-muted-foreground">{label}</span><strong className="font-mono">{inr(value as number)}</strong>
          </div>)}
        </div>
        {validation.length>0 && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <p className="font-medium">Complete these fields before saving</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">{validation.slice(0,15).map((e,i)=><li key={i}>{e}</li>)}</ul>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            Historical payments are archived immediately with the bill. Only its unpaid balance can enter the future payment-approval flow.
          </p>
          <Button type="submit" disabled={!canSave}>{save.isPending?"Saving…":editId?"Update opening bill":"Save bill for verification"}</Button>
        </div>
      </section>
    </form>
  </div>;
}
