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
import { useCan } from "@/lib/session";
import { cn } from "@/lib/utils";
import { loadCompleteRows } from "@/lib/complete-register";
import { InlineBillMaterialPicker } from "@/components/erp/inline-bill-material-picker";
import { materialLineDefaults, type BillMaterialOption } from "@/lib/bill-materials";
import type { InvoiceRoundOffMode } from "@/lib/invoice-roundoff";
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
  vendor_invoice_date: string; due_date: string; gst_type: OpeningGST; round_off_mode: InvoiceRoundOffMode;
  freight: string; other_charges: string; tds_section: string; tds_rate: string; remarks: string;
};
const initial: Header = {
  vendor_id: "", project_id: "", building_id: "", vendor_invoice_number: "",
  vendor_invoice_date: today(), due_date: "", gst_type: "cgst_sgst", round_off_mode: "none",
  freight: "0", other_charges: "0", tds_section: "", tds_rate: "0", remarks: "",
};
const toStr = (v: string | number | null | undefined, fallback = "") => v == null ? fallback : String(v);
const box = "rounded-xl border bg-card p-4 sm:p-5";

function OpeningBill() {
  const { id: editId } = Route.useSearch();
  const nav = useNavigate(), qc = useQueryClient();
  const can = useCan();
  const [h, setH] = useState<Header>(initial);
  const [lines, setLines] = useState<OpeningLine[]>([newOpeningLine("initial")]);
  const [payments, setPayments] = useState<HistoricPayment[]>([]);
  const [legacyPaid, setLegacyPaid] = useState(0);
  const [correctionReason, setCorrectionReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const set = (field: keyof Header, value: string) => setH(current => ({ ...current, [field]: value }));
  const changeLine = (id: string, field: keyof OpeningLine, value: string) =>
    setLines(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  const typeMaterial = (id: string, description: string) =>
    setLines(prev=>prev.map(row=>row.id===id?{...row,description,material_id:""}:row));
  const chooseMaterial = (id: string, material: BillMaterialOption) =>
    setLines(prev=>prev.map(row=>row.id===id?{...row,...materialLineDefaults(material)}:row));
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
  const materials = useQuery({
    queryKey: ["old-bill-materials"],
    enabled: can("materials.view"),
    queryFn: async () => loadCompleteRows(async (start,end) => await supabase.from("items")
      .select("id,code,name,hsn_sac,category_id,unit_id,units_of_measure(code,name)",{count:"exact"})
      .eq("status","active").order("name").order("id").range(start,end)),
  });
  const materialRefs = useQuery({
    queryKey: ["old-bill-material-refs"],
    enabled: can("materials.view"),
    queryFn: async () => {
      const [categories,units] = await Promise.all([
        supabase.from("item_categories").select("id,code,name").eq("status","active").order("name"),
        supabase.from("units_of_measure").select("id,code,name").eq("status","active").order("name"),
      ]);
      if(categories.error) throw categories.error;
      if(units.error) throw units.error;
      return {categories:categories.data??[],units:units.data??[]};
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
      vendor_invoice_date:inv.vendor_invoice_date,due_date:inv.due_date ?? "",round_off_mode:(inv.round_off_mode??"none") as InvoiceRoundOffMode,
      gst_type:(match['gst_type'] === "none" || match['gst_type'] === "igst" || match['gst_type'] === "cgst_sgst")
        ? match['gst_type'] : (Number(inv.igst)>0 ? "igst" : "cgst_sgst"),
      freight:toStr(inv.freight,"0"),other_charges:toStr(inv.other_charges,"0"),
      tds_section:inv.tds_section ?? "",tds_rate:toStr(inv.tds_rate,"0"),remarks:inv.remarks ?? "",
    });
    setLegacyPaid(Number(inv.opening_legacy_paid) || 0);
    setLines(entry.lines.length ? entry.lines.map(row => ({
      id:row.id,material_id:row.material_id??"",description:row.description,hsn_sac:row.hsn_sac ?? "",
      unit:row.unit,quantity:toStr(row.quantity),rate:toStr(row.rate),
      discount:toStr(row.discount),tax_rate:toStr(row.tax_rate),
    })) : [newOpeningLine("initial")]);
    setPayments(entry.payments.map(row => ({
      id:row.id,payment_date:row.payment_date,payment_mode:row.payment_mode,
      reference:row.reference ?? "",amount:toStr(row.amount),remarks:row.remarks ?? "",
    })));
  }, [existing.data]);

  const isApprovedCorrection = !!editId && ["approved","partially_paid","paid"].includes(existing.data?.invoice.status ?? "");
  const canEdit = !editId || existing.data?.invoice.status === "pending_review" || (isApprovedCorrection && can("vendor_invoice.create") && can("vendor_invoice.approve"));
  const financialEditable = !!canEdit && !isApprovedCorrection;
  const calc = evaluateOpeningBill({
    lines,payments,gstType:h.gst_type,freight:h.freight,
    otherCharges:h.other_charges,tdsRate:h.tds_rate,legacyPaid,roundOffMode:h.round_off_mode,
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
    ...(editId && !canEdit ? ["This invoice requires an authorized Accounts user to edit it."] : []),
    ...(isApprovedCorrection && (Math.abs(calc.subtotal-Number(existing.data?.invoice.subtotal??0)) > 0.001 ||
      Math.abs(calc.taxTotal-Number(existing.data?.invoice.tax_total??0)) > 0.001)
      ? ["For approved bills, the sum of item prices and GST must equal the original approved taxable and GST totals. Financial amendments require accounting review."] : []),
    ...(isApprovedCorrection && (correctionReason.trim().length<10 || correctionReason.trim().length>500)
      ? ["Enter a correction reason (10–500 characters) for the audit history."] : []),
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
        _lines:lines.map(({material_id,description,hsn_sac,unit,quantity,rate,discount,tax_rate})=>({
          material_id:material_id||null,description,hsn_sac,unit,quantity,rate,discount,tax_rate,
        })),
        _payments:payments.map(({payment_date,payment_mode,reference,amount,remarks})=>({
          payment_date,payment_mode,reference,amount,remarks,
        })),
      };
      const {data,error}=isApprovedCorrection
        ? await supabase.rpc("correct_approved_opening_vendor_invoice",{
            _id:editId!,
            _lines:payload._lines,
            _remarks:h.remarks,
            _attachment_path:attachment_path,
            _reason:correctionReason.trim(),
            _expected_updated_at:existing.data!.invoice.updated_at,
          })
        : await supabase.rpc("save_opening_vendor_invoice_v2",(({_id,...rest})=>_id?{...rest,_id}:rest)(payload));
      if(error){
        if(error.message.startsWith("DUPLICATE_INVOICE"))
          throw new Error("This vendor bill is already registered as "+(error.message.split("|")[2] ?? "another invoice")+".");
        throw error;
      }
      return data as string;
    },
    onSuccess:(id)=>{
      toast.success(isApprovedCorrection?"Item details corrected; approved totals unchanged":editId?"Opening bill updated":"Old bill saved for verification");
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
  const canSave = canEdit && !save.isPending && !base.isFetching &&
    (!editId || !existing.isFetching) && validation.length===0;

  return <div className="mx-auto max-w-7xl space-y-5 pb-20">
    <PageHeader title={editId ? isApprovedCorrection ? "Correct approved old bill details" : "Edit old vendor bill" : "Old vendor bill entry"}
      subtitle="General construction invoices: materials, equipment, supply, subcontract and labour, with item-wise unit prices and actual historical payments."/>
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 dark:bg-sky-950/20 dark:text-sky-100">
      <strong>Historical entry, not a new purchase or payment.</strong> No PO or GRN is required. Previously completed payments are recorded without director payment approval and never create a new bank/cash transaction. Any fresh payment against an outstanding balance still follows the standard approval workflow.
    </div>
    {editId && existing.data?.lines.length===0 && <p className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950">
      This bill was entered using the old amount-only form. Enter the actual bill lines below to itemize it; verify the new total before saving. Previously recorded paid amounts remain preserved.
    </p>}
    {isApprovedCorrection && <p className="rounded-lg border bg-muted/40 p-3 text-sm">This bill is already approved or paid. You can correct item descriptions, quantities, unit prices, GST breakdown, remarks and the attached document only if the original taxable value and GST remain exactly unchanged. Prior payments and posted accounts are locked. Provide a reason below; corrections are recorded in the invoice history.</p>}
    {!canEdit && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      Only authorized Accounts staff can correct approved invoice documentation.
    </p>}
    <form className="space-y-5" onSubmit={e=>{e.preventDefault();if(canSave)save.mutate();}}>
      <section className={box}>
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><FileText className="h-4 w-4"/> Bill information</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Supplier / Vendor *"><select className={selectCls} value={h.vendor_id} disabled={!financialEditable || !!editId}
            onChange={e=>set("vendor_id",e.target.value)}><option value="">Select vendor</option>
            {data.vendors.map(v=><option key={v.id} value={v.id}>{v.company_name}</option>)}</select></Field>
          <Field label="Project *"><select className={selectCls} value={h.project_id} disabled={!financialEditable || !!editId}
            onChange={e=>setH(v=>({...v,project_id:e.target.value,building_id:""}))}><option value="">Select project</option>
            {data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Building"><select className={selectCls} disabled={!financialEditable} value={h.building_id}
            onChange={e=>set("building_id",e.target.value)}><option value="">No specific building</option>
            {buildingOptions.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Supplier's bill number *"><Input disabled={!financialEditable} maxLength={100} value={h.vendor_invoice_number}
            onChange={e=>set("vendor_invoice_number",e.target.value)} placeholder="As printed on supplier invoice"/></Field>
          <Field label="Original bill date *"><Input disabled={!financialEditable} type="date" max={today()} value={h.vendor_invoice_date}
            onChange={e=>set("vendor_invoice_date",e.target.value)}/></Field>
          <Field label="Due date"><Input disabled={!financialEditable} type="date" min={h.vendor_invoice_date} value={h.due_date}
            onChange={e=>set("due_date",e.target.value)}/></Field>
          <Field label="GST treatment"><select disabled={!financialEditable} className={selectCls} value={h.gst_type}
            onChange={e=>{const v=e.target.value as OpeningGST;set("gst_type",v);
              if(v==="none")setLines(prev=>prev.map(row=>({...row,tax_rate:"0"})));}}>
            <option value="cgst_sgst">CGST + SGST (intra-state)</option><option value="igst">IGST (inter-state)</option>
            <option value="none">No GST</option></select></Field>
          <Field label="Invoice copy (PDF/image)"><Input disabled={!canEdit} type="file" accept="application/pdf,image/*"
            onChange={e=>setFile(e.target.files?.[0]??null)}/></Field>
        </div>
      </section>

      <section className={box}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Item-wise construction bill</h2>
            <p className="text-xs text-muted-foreground">Enter every material, equipment charge, labour or service from the supplier's original bill. Unit prices are shown on each item.</p>
          </div>
          <Button type="button" disabled={!canEdit || lines.length>=100} size="sm" variant="outline"
            onClick={()=>setLines(rows=>[...rows,newOpeningLine(crypto.randomUUID())])}>
            <Plus className="mr-1 h-4 w-4"/>Add another item
          </Button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">Pick a saved material to autofill its master unit and HSN/SAC. No match? Authorized staff can create it here without losing this bill.</p>
        <div className="space-y-3">
          {lines.map((item,index)=>{
            const amount=calc.computed[index];
            return <div key={item.id} className="rounded-lg border p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Item {index+1}{item.description.trim() ? " · "+item.description.trim().slice(0,48) : ""}</div>
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="ghost" disabled={!canEdit || lines.length>=100}
                    onClick={()=>setLines(rows=>{
                      const copy={...item,id:crypto.randomUUID()};
                      return [...rows.slice(0,index+1),copy,...rows.slice(index+1)];
                    })}>Duplicate</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={!canEdit || lines.length===1}
                    aria-label={"Remove item "+(index+1)} onClick={()=>setLines(rows=>rows.filter(x=>x.id!==item.id))}>
                    <Trash2 className="h-4 w-4"/><span className="ml-1">Remove</span>
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <Field label="Material / work / service *">
                    <InlineBillMaterialPicker
                      itemId={item.id}
                      value={item.description}
                      materialId={item.material_id??""}
                      disabled={!canEdit}
                      materials={(materials.data??[]) as BillMaterialOption[]}
                      loading={can("materials.view") && materials.isLoading}
                      error={!can("materials.view")?"You do not have Materials viewing permission.":materials.error?errMsg(materials.error):null}
                      canCreate={can("materials.manage")||can("materials.edit")}
                      categories={materialRefs.data?.categories??[]}
                      units={materialRefs.data?.units??[]}
                      onType={description=>typeMaterial(item.id,description)}
                      onPick={material=>chooseMaterial(item.id,material)}
                    />
                  </Field>
                </div>
                <Field label="HSN / SAC (if applicable)">
                  <Input aria-label={"Item "+(index+1)+" HSN or SAC"} disabled={!canEdit} maxLength={30}
                    value={item.hsn_sac} onChange={e=>changeLine(item.id,"hsn_sac",e.target.value)}/>
                </Field>
                <Field label={item.material_id?"Unit (from Materials master) *":"Unit *"}>
                  <Input aria-label={"Item "+(index+1)+" unit"} disabled={!canEdit || !!item.material_id} maxLength={25} list="opening-bill-units"
                    value={item.unit} onChange={e=>changeLine(item.id,"unit",e.target.value)} placeholder="Select a material for its unit"/>
                </Field>
                <Field label="Quantity / weight *">
                  <Input aria-label={"Item "+(index+1)+" quantity"} disabled={!canEdit} inputMode="decimal"
                    value={item.quantity} onChange={e=>changeLine(item.id,"quantity",e.target.value)}/>
                </Field>
                <Field label={"Unit price (₹ per "+(item.unit.trim()||"unit")+") *"}>
                  <Input aria-label={"Item "+(index+1)+" unit price"} disabled={!canEdit} inputMode="decimal"
                    value={item.rate} onChange={e=>changeLine(item.id,"rate",e.target.value)}
                    placeholder="Enter price per unit"/>
                </Field>
                <Field label="Line discount (₹)">
                  <Input aria-label={"Item "+(index+1)+" discount"} disabled={!canEdit} inputMode="decimal"
                    value={item.discount} onChange={e=>changeLine(item.id,"discount",e.target.value)}/>
                </Field>
                <Field label="GST on this item (%)">
                  <Input aria-label={"Item "+(index+1)+" GST rate"} disabled={!canEdit || h.gst_type==="none"}
                    inputMode="decimal" value={item.tax_rate} onChange={e=>changeLine(item.id,"tax_rate",e.target.value)}/>
                </Field>
              </div>
              <div className="mt-3 grid gap-2 border-t pt-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><span className="text-muted-foreground">Quantity × unit price</span><div className="font-mono font-medium">{inr(Number(item.quantity||0)*Number(item.rate||0))}</div></div>
                <div><span className="text-muted-foreground">After discount (taxable)</span><div className="font-mono font-medium">{inr(amount?.taxable??0)}</div></div>
                <div><span className="text-muted-foreground">GST amount</span><div className="font-mono font-medium">{inr(amount?.taxAmount??0)}</div></div>
                <div><span className="font-medium">Total for this item</span><div className="font-mono text-base font-semibold">{inr(amount?.total??0)}</div></div>
              </div>
            </div>;
          })}
        </div>
        <datalist id="opening-bill-units">
          {materialRefs.data?.units.map(u=><option key={u.id} value={u.code} label={u.name}/>)}
        </datalist>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">Each line has its own price and GST. Historical entries do not change today's stock.</p>
          <Button type="button" size="sm" variant="outline" disabled={!canEdit || lines.length>=100}
            onClick={()=>setLines(rows=>[...rows,newOpeningLine(crypto.randomUUID())])}>
            <Plus className="mr-1 h-4 w-4"/>Add item
          </Button>
        </div>
      </section>

      <section className={box}>
        <h2 className="mb-3 font-semibold">Additional amounts and deductions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Freight (₹)"><Input disabled={!financialEditable} inputMode="decimal" value={h.freight} onChange={e=>set("freight",e.target.value)}/></Field>
          <Field label="Other charges (₹)"><Input disabled={!financialEditable} inputMode="decimal" value={h.other_charges} onChange={e=>set("other_charges",e.target.value)}/></Field>
          <Field label="TDS section (if applicable)"><Input disabled={!financialEditable} maxLength={30} placeholder="e.g. 194C"
            value={h.tds_section} onChange={e=>set("tds_section",e.target.value)}/></Field>
          <Field label="TDS rate %"><Input disabled={!financialEditable} inputMode="decimal" value={h.tds_rate} onChange={e=>set("tds_rate",e.target.value)}/></Field>
          <Field label="Invoice round-off (optional)">
            <select disabled={!financialEditable} className={selectCls} value={h.round_off_mode}
              onChange={e=>setH(v=>({...v,round_off_mode:e.target.value as InvoiceRoundOffMode}))}>
              <option value="none">No round-off — exact paise (default)</option>
              <option value="nearest_rupee">Apply nearest-rupee round-off</option>
            </select>
          </Field>
        </div>
      </section>

      <section className={box}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="flex items-center gap-2 font-semibold"><ReceiptText className="h-4 w-4"/>Payments already made before ERP</h2>
            <p className="text-xs text-muted-foreground">Historical payment record only. No director payment approval, no new bank debit and no vendor-payment scheduling.</p></div>
          <Button type="button" size="sm" variant="outline" disabled={!financialEditable || payments.length>=100}
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
          <Field label="Payment date"><Input disabled={!financialEditable} type="date" max={today()} value={p.payment_date}
            onChange={e=>changePayment(p.id,"payment_date",e.target.value)}/></Field>
          <Field label="Payment mode"><select disabled={!financialEditable} className={selectCls} value={p.payment_mode}
            onChange={e=>changePayment(p.id,"payment_mode",e.target.value)}>
            {PAYMENT_MODES.map(([code,label])=><option key={code} value={code}>{label}</option>)}
            <option value="card">Card</option></select></Field>
          <Field label="Amount paid (₹)"><Input disabled={!financialEditable} inputMode="decimal" value={p.amount}
            onChange={e=>changePayment(p.id,"amount",e.target.value)}/></Field>
          <Field label="UTR / cheque / reference"><Input disabled={!financialEditable} maxLength={150} value={p.reference}
            onChange={e=>changePayment(p.id,"reference",e.target.value)}/></Field>
          <Field label="Remarks"><Input disabled={!financialEditable} maxLength={500} value={p.remarks}
            onChange={e=>changePayment(p.id,"remarks",e.target.value)}/></Field>
          <div className="flex items-end justify-end">
            <Button type="button" disabled={!financialEditable} size="sm" variant="ghost"
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

      {isApprovedCorrection && <section className={box}><Field label="Reason for correcting approved bill details *"><Textarea rows={2} minLength={10} maxLength={500} value={correctionReason} onChange={e=>setCorrectionReason(e.target.value)} placeholder="Explain which item details are being corrected and why, with reference to the original supplier bill."/></Field></section>}

      <section className={cn(box,"space-y-3")}>
        <h2 className="font-semibold">Bill and outstanding summary</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          {[
            ["Taxable value",calc.subtotal],["GST amount",calc.taxTotal],
            ["Freight + charges",Number(h.freight||0)+Number(h.other_charges||0)],
            ["Before round-off",calc.gross],["Optional round-off",calc.roundOffAmount],
            ["Gross invoice",calc.adjustedGross],["TDS",calc.tds],["Net payable",calc.net],
            ["Already paid (historic)",calc.paid+calc.legacyPaid],["Remaining unpaid",calc.balance],
          ].map(([label,value])=><div key={label as string} className="flex justify-between gap-3 rounded-lg bg-muted/40 p-3">
            <span className="text-muted-foreground">{label}</span><strong className="font-mono">{inr(value as number)}</strong>
          </div>)}
        </div>
        <p className="text-xs text-muted-foreground">Round-off is OFF by default. When selected, only the final invoice gross changes by up to ₹0.50; item prices, taxable amounts, GST and TDS remain unchanged.</p>
        {validation.length>0 && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <p className="font-medium">Complete these fields before saving</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">{validation.slice(0,15).map((e,i)=><li key={i}>{e}</li>)}</ul>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            Historical payments are archived immediately with the bill. Only its unpaid balance can enter the future payment-approval flow.
          </p>
          <Button type="submit" disabled={!canSave}>{save.isPending?"Saving…":isApprovedCorrection?"Save audited item correction":editId?"Update opening bill":"Save bill for verification"}</Button>
        </div>
      </section>
    </form>
  </div>;
}
