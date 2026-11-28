import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { showDocument } from "@/components/erp/document-viewer";
import { SALES_HEADERS,downloadCsv,readFlatSpreadsheet,type SalesRow } from "@/lib/sales-spreadsheet";

// Every mutation uses the corresponding role- and project-scoped PostgreSQL RPC.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db=supabase as any;
const money=(x:unknown)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(x)||0);
const input="h-10 w-full rounded-lg border bg-background px-3 text-sm";
const today=()=>new Date().toLocaleDateString("en-CA");
const err=(x:unknown)=>x instanceof Error?x.message:String(x);
export type CommercialFlat={
 id:string;unit_number:string;project_id:string;building_id:string;
 status:string;saleable_area:number;base_rate:number;floor_rise_rate:number;
 parking_charges:number;other_charges:number;gst_rate:number;total_agreement_value:number;
};
export type CommercialBooking={
 id:string;unit_id:string;project_id:string;sale_number:string;buyer_name:string;
 buyer_mobile:string;buyer_email:string|null;final_sale_price:number;status:string;
};
type Building={id:string;name:string;project_id:string};
type Props={
 mode:"import"|"price"|"buyer";project:string;buildings:Building[];
 flat?:CommercialFlat|null|undefined;booking?:CommercialBooking|null|undefined;
 manager:boolean;canImport?:boolean;companyId:string;actorId:string;
 onClose:()=>void;onSaved:()=>void;
};
async function rpc(name:string,args:Record<string,unknown>){
 const r=await db.rpc(name,args);if(r.error)throw r.error;return r.data;
}
function Field({label,children}:{label:string;children:React.ReactNode}){
 return <label className="block space-y-1.5 text-xs font-semibold text-muted-foreground">
  <span>{label}</span>{children}</label>;
}

function ImportFlats({project,buildings,onSaved,onClose}:Pick<Props,"project"|"buildings"|"onSaved"|"onClose">){
 const [building,setBuilding]=useState("");
 const [rows,setRows]=useState<SalesRow[]>([]);
 const [fileName,setFileName]=useState("");
 const [validated,setValidated]=useState(false);
 const [busy,setBusy]=useState(false);
 const options=buildings.filter(b=>!project||b.project_id===project);
 const reset=()=>{setRows([]);setFileName("");setValidated(false);};
 const parse=async(file:File|undefined)=>{
  reset();if(!file)return;
  try {const parsed=await readFlatSpreadsheet(file);setRows(parsed);setFileName(file.name);}
  catch(e){toast.error(err(e));}
 };
 const act=async(dry_run:boolean)=>{
  if(!building||!rows.length||busy)return;
  setBusy(true);
  try {
   const result=await rpc("sales_import_flat_rows",{_building_id:building,_rows:rows,_dry_run:dry_run}) as
     {validated:number;created:number;dry_run:boolean};
   if(dry_run){setValidated(true);toast.success(`${result.validated} flats validated — no records created yet`);}
   else{toast.success(`${result.created} flats imported successfully`);onSaved();onClose();}
  }catch(e){setValidated(false);toast.error("Import rejected: "+err(e));}
  finally{setBusy(false);}
 };
 return <div className="space-y-3">
  <p className="text-sm text-muted-foreground">
   Excel .xlsx (first worksheet) or CSV. Import up to 300 flats per file into one building.
   Existing flat numbers are never overwritten; a rejected batch creates nothing.
  </p>
  <Button type="button" variant="outline" size="sm" onClick={()=>downloadCsv("kk-sales-flat-import-template.csv",[
   [...SALES_HEADERS],["1","101","2bhk","600","700","800","4500","0","0","5"],
   ["1","102","2bhk","600","700","800","4500","0","0","5"],
  ])}>Download Excel/CSV template</Button>
  <Field label="Building / tower *"><select className={input} value={building}
   onChange={e=>{setBuilding(e.target.value);reset();}}>
   <option value="">Select building</option>
   {options.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
  </select></Field>
  <Field label="Excel .xlsx or CSV *">
   <input className="w-full text-sm" type="file" accept=".xlsx,.csv,text/csv"
     onChange={e=>void parse(e.target.files?.[0])}/>
  </Field>
  {rows.length>0&&<>
   <p className="text-sm font-medium">{fileName} · {rows.length} flats</p>
   <div className="max-h-52 overflow-auto rounded-lg border">
    <table className="w-full min-w-[600px] text-xs"><thead className="bg-muted/50">
     <tr>{["Floor","Flat","Type","Saleable","Rate"].map(x=><th className="p-2 text-left" key={x}>{x}</th>)}</tr></thead>
     <tbody>{rows.slice(0,10).map((r,i)=><tr className="border-t" key={i}>
      {[r.floor_number,r.flat_number,r.type,r.saleable_area,r.rate].map((v,j)=><td className="p-2" key={j}>{v}</td>)}
     </tr>)}</tbody>
    </table>
   </div>
   {rows.length>10&&<p className="text-xs text-muted-foreground">Showing first 10 rows for preview.</p>}
  </>}
  <div className="flex flex-wrap gap-2">
   <Button disabled={!building||!rows.length||busy} variant="outline" onClick={()=>void act(true)}>
    {busy?"Validating…":"Validate all rows"}</Button>
   <Button disabled={!validated||busy} onClick={()=>void act(false)}>
    {busy?"Importing…":`Import ${rows.length} flats`}</Button>
  </div>
  {validated&&<p className="text-xs text-emerald-700">
   Validation passed. Final import rechecks every row; conflicts during concurrent edits abort the batch.
  </p>}
 </div>;
}
function PriceRevision({flat,onSaved,onClose}:{
 flat:CommercialFlat;onSaved:()=>void;onClose:()=>void;
}){
 const [form,setForm]=useState({
  base:String(flat.base_rate),rise:String(flat.floor_rise_rate),parking:String(flat.parking_charges),
  other:String(flat.other_charges),gst:String(flat.gst_rate),reason:"",
 });
 const [busy,setBusy]=useState(false);
 const set=(key:keyof typeof form,v:string)=>setForm(p=>({...p,[key]:v}));
 const preview=((Number(form.base)+Number(form.rise))*flat.saleable_area+
  Number(form.parking)+Number(form.other))*(1+Number(form.gst)/100);
 const submit=async(e:React.FormEvent)=>{
  e.preventDefault();setBusy(true);
  try {
   const total=await rpc("sales_reprice_flat",{
    _unit_id:flat.id,_base_rate:Number(form.base),_floor_rise:Number(form.rise),
    _parking:Number(form.parking),_other:Number(form.other),_gst:Number(form.gst),_reason:form.reason,
   });
   toast.success("Flat price revised; new agreement value "+money(total));onSaved();onClose();
  }catch(e){toast.error(err(e));}finally{setBusy(false);}
 };
 return <form className="space-y-3" onSubmit={e=>void submit(e)}>
  <p className="rounded-lg bg-muted p-3 text-sm">
   Flat <b>{flat.unit_number}</b> · Current listing {money(flat.total_agreement_value)}.
   Only available flats can be repriced. Existing booking prices are never changed.
  </p>
  <div className="grid grid-cols-2 gap-3">
   {([
    ["base","Base rate (₹/sqft)"],["rise","Floor rise (₹/sqft)"],
    ["parking","Parking (₹)"],["other","Other charges (₹)"],["gst","GST rate (%)"],
   ] as const).map(([k,label])=><Field key={k} label={label}>
    <input type="number" required min={k==="base"?"0.01":"0"} max={k==="gst"?"28":undefined}
     step=".01" className={input} value={form[k]} onChange={e=>set(k,e.target.value)}/>
   </Field>)}
  </div>
  <p className="rounded-lg border p-3 text-sm">Estimated new agreement value:
   <b className="ml-2">{money(preview)}</b> (database recalculates exact paise)
  </p>
  <Field label="Reason for revision *"><textarea className={input+" min-h-24 py-2"} required minLength={10}
   value={form.reason} onChange={e=>set("reason",e.target.value)}/></Field>
  <Button className="w-full" type="submit" disabled={busy||form.reason.trim().length<10}>
   {busy?"Saving…":"Save audited price change"}
  </Button>
 </form>;
}

type BuyerInfo={address:string|null;city:string|null;state:string|null;pincode:string|null;
 alternate_mobile:string|null;identification_type:string|null;identification_last4:string|null;notes:string|null};
type LegalInfo={agreement_number:string|null;agreement_date:string|null;
 registration_number:string|null;registration_date:string|null;registration_office:string|null;notes:string|null};
type Milestone={sequence:number;label:string;due_on:string;expected:number;credited:number;outstanding:number};
type Doc={id:string;kind:string;filename:string;storage_path:string;uploaded_at:string};
const docKinds={
 buyer_id:"Buyer ID proof",booking_form:"Booking form",agreement:"Signed agreement",
 registration:"Registration document",payment_proof:"Payment proof",other:"Other supporting file",
} as const;
function BookingWorkspace({booking,manager,companyId,actorId,onSaved}:{
 booking:CommercialBooking;manager:boolean;companyId:string;actorId:string;onSaved:()=>void;
}){
 const qc=useQueryClient();
 const [section,setSection]=useState<"buyer"|"terms"|"plan"|"legal"|"documents">("buyer");
 const [busy,setBusy]=useState(false);
 const [buyer,setBuyer]=useState<Record<string,string>>({});
 const [terms,setTerms]=useState<Record<string,string>>({});
 const termsQ=useQuery({queryKey:["sales-deal-terms",booking.id],enabled:section==="terms",queryFn:async()=>{const r=await db.from("property_sales").select("agreed_rate_per_sqft,agreed_rate_basis,granted_amenities,bonus_items,referral_details").eq("id",booking.id).single();if(r.error)throw r.error;return r.data as Record<string,string|number|null>;}});
 const tval=(key:string)=>terms[key]??String(termsQ.data?.[key]??"");
 const [legal,setLegal]=useState<Record<string,string>>({});
 const [plan,setPlan]=useState<{label:string;due_on:string;amount:string}[]>([
  {label:"Booking",due_on:today(),amount:String(booking.final_sale_price)},
 ]);
 const [planReason,setPlanReason]=useState("Initial schedule");
 const [kind,setKind]=useState<keyof typeof docKinds>("booking_form");
 const [file,setFile]=useState<File|null>(null);
 const details=useQuery({
  queryKey:["sales-buyer-details",booking.id],
  queryFn:async()=>{
   const result=await db.from("property_sale_buyer_details").select("*").eq("sale_id",booking.id).maybeSingle();
   if(result.error)throw result.error;return result.data as BuyerInfo|null;
  },
 });
 const legality=useQuery({
  queryKey:["sales-legal-details",booking.id],
  queryFn:async()=>{
   const result=await db.from("property_sale_legal_details").select("*").eq("sale_id",booking.id).maybeSingle();
   if(result.error)throw result.error;return result.data as LegalInfo|null;
  },
 });
 const milestones=useQuery({
  queryKey:["sales-current-milestones",booking.id],
  queryFn:async()=>await rpc("sales_current_milestones",{_sale_id:booking.id}) as Milestone[],
 });
 const documents=useQuery({
  queryKey:["sales-private-documents",booking.id],
  queryFn:async()=>{
   const r=await db.from("property_sale_documents")
    .select("id,kind,filename,storage_path,uploaded_at").eq("sale_id",booking.id)
    .order("uploaded_at",{ascending:false}).limit(80);
   if(r.error)throw r.error;return (r.data??[]) as Doc[];
  },
 });
 const info=(key:string)=>buyer[key]??String(details.data?.[key as keyof BuyerInfo]??"");
 const lval=(key:string)=>legal[key]??String(legality.data?.[key as keyof LegalInfo]??"");
 const patch=(key:string,value:string,set:React.Dispatch<React.SetStateAction<Record<string,string>>>)=>
  set(prev=>({...prev,[key]:value}));
 const run=async(name:string,args:Record<string,unknown>,message:string,keys:readonly string[])=>{
  if(busy)return;setBusy(true);
  try{
   await rpc(name,args);toast.success(message);
   for(const key of keys)void qc.invalidateQueries({queryKey:[key,booking.id]});
   onSaved();
  }catch(e){toast.error(err(e));}finally{setBusy(false);}
 };
 const openFile=async(doc:Doc)=>{
  try{
   const response=await supabase.storage.from("sales-documents").download(doc.storage_path);
   if(response.error)throw response.error;
   const blob=response.data;
   showDocument({url:URL.createObjectURL(blob),
    type:blob.type||((doc.filename.toLowerCase().endsWith(".pdf"))?"application/pdf":"image/png"),
    name:doc.filename});
  }catch(e){toast.error("Could not view private file: "+err(e));}
 };
 const upload=async()=>{
  if(!file||busy)return;
  const allowed=new Map([["pdf","application/pdf"],["jpg","image/jpeg"],["jpeg","image/jpeg"],["png","image/png"]]);
  const ext=file.name.toLowerCase().split(".").pop()??"";
  if(!allowed.has(ext)||file.type!==allowed.get(ext)||file.size<1||file.size>10*1024*1024){
   toast.error("Use a PDF, JPG or PNG of at most 10 MB");return;
  }
  if(!companyId||!actorId){toast.error("Sign in before uploading");return;}
  setBusy(true);
  try{
   const path=`${companyId}/${booking.id}/${actorId}/${crypto.randomUUID()}.${ext}`;
   const r=await supabase.storage.from("sales-documents").upload(path,file,{
    contentType:file.type,upsert:false});
   if(r.error)throw r.error;
   await rpc("sales_link_document",{_sale_id:booking.id,_kind:kind,_path:path,_filename:file.name.slice(0,150)});
   toast.success("Private document attached");setFile(null);
   void qc.invalidateQueries({queryKey:["sales-private-documents",booking.id]});onSaved();
  }catch(e){toast.error(err(e));}
  finally{setBusy(false);}
 };
 const total=plan.reduce((a,r)=>a+(Number(r.amount)||0),0);
 return <div className="space-y-3">
  <div className="rounded-lg bg-muted p-3 text-sm">
   <strong>{booking.sale_number}</strong> · {booking.buyer_name} · {booking.buyer_mobile}
   <p className="mt-1 text-xs text-muted-foreground">{money(booking.final_sale_price)} agreed · {booking.status.replaceAll("_"," ")}</p>
  </div>
  <div role="tablist" aria-label="Buyer booking details" className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
   {([["buyer","Buyer"],["terms","Deal terms"],["plan","Payment plan"],["legal","Agreement"],["documents","Files"]] as const)
    .map(([key,title])=><button key={key} role="tab" aria-selected={section===key}
     onClick={()=>setSection(key)} className={"shrink-0 rounded-md px-3 py-2 text-xs "+(section===key?"bg-background font-semibold":"")}>
     {title}</button>)}
  </div>
  {section==="terms"&&(termsQ.isLoading?<p>Loading deal terms…</p>:termsQ.error?<p role="alert" className="text-destructive">{err(termsQ.error)}</p>:termsQ.isSuccess&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void run("sales_save_deal_terms",{_sale_id:booking.id,_rate:tval("agreed_rate_per_sqft")?Number(tval("agreed_rate_per_sqft")):null,_basis:tval("agreed_rate_per_sqft")?tval("agreed_rate_basis")||"saleable":null,_amenities:tval("granted_amenities"),_bonus:tval("bonus_items"),_referral:tval("referral_details")},"Deal terms saved",["sales-deal-terms"]);}}>
    <Field label="Agreed rate (₹/sqft)"><input className={input} type="number" min=".01" step=".01" value={tval("agreed_rate_per_sqft")} onChange={e=>patch("agreed_rate_per_sqft",e.target.value,setTerms)}/></Field>
    <Field label="Area basis"><select className={input} value={tval("agreed_rate_basis")||"saleable"} onChange={e=>patch("agreed_rate_basis",e.target.value,setTerms)}><option value="saleable">Saleable</option><option value="carpet">Carpet</option><option value="built_up">Built-up</option></select></Field>
    {([["granted_amenities","Amenities granted"],["bonus_items","Complimentary items / bonus"],["referral_details","Referral details"]] as const).map(([key,label])=><Field key={key} label={label}><textarea maxLength={2000} className={input+" min-h-20 py-2"} value={tval(key)} onChange={e=>patch(key,e.target.value,setTerms)}/></Field>)}
    <p className="text-xs text-muted-foreground">These are documented deal terms. They do not modify the agreed sale price or verified collections.</p>
    <Button disabled={busy||booking.status==="cancelled"} type="submit">Save deal terms</Button>
  </form>)}
  {section==="buyer"&&<form className="space-y-3" onSubmit={e=>{
   e.preventDefault();void run("sales_save_buyer_details",{
    _sale_id:booking.id,_address:info("address"),_city:info("city"),
    _state:info("state"),_pincode:info("pincode"),_alternate:info("alternate_mobile"),
    _id_type:info("identification_type")||null,_last4:info("identification_last4")||null,
    _notes:info("notes"),
   },"Buyer details saved",["sales-buyer-details"]);
  }}>
   {details.isLoading?<p className="text-xs">Loading buyer details…</p>:details.isError?
    <p role="alert" className="text-sm text-destructive">{err(details.error)}</p>:<>
    <div className="grid grid-cols-2 gap-3">
     {([["city","City"],["state","State"],["pincode","PIN code"],
       ["alternate_mobile","Alternate phone"]] as const).map(([key,label])=>
      <Field key={key} label={label}><input className={input} value={info(key)}
       onChange={e=>patch(key,e.target.value,setBuyer)}/></Field>)}
    </div>
    <Field label="Correspondence address"><textarea className={input+" min-h-20 py-2"} maxLength={500}
     value={info("address")} onChange={e=>patch("address",e.target.value,setBuyer)}/></Field>
    <div className="grid grid-cols-2 gap-3">
     <Field label="ID type"><select className={input} value={info("identification_type")}
      onChange={e=>patch("identification_type",e.target.value,setBuyer)}>
      <option value="">Not recorded</option>{["pan","aadhaar","passport","driving_license","other"]
       .map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}
     </select></Field>
     <Field label="Only final 4 ID characters"><input className={input} maxLength={4}
      value={info("identification_last4")} onChange={e=>patch("identification_last4",e.target.value,setBuyer)}/></Field>
    </div>
    <Field label="Notes"><textarea className={input+" min-h-20 py-2"} maxLength={2000}
     value={info("notes")} onChange={e=>patch("notes",e.target.value,setBuyer)}/></Field>
    <p className="text-xs text-muted-foreground">Full PAN/Aadhaar numbers must not be entered in text fields. Upload a protected proof instead.</p>
    <Button disabled={busy} type="submit">Save buyer details</Button>
   </>}
  </form>}
  {section==="plan"&&<div className="space-y-3">
   <p className="text-xs text-muted-foreground">
    Instalment credits are an indicative distribution of verified receipts in due order,
    not a confirmed receipt allocation. Reported payments are excluded.
   </p>
   {milestones.isLoading?<p className="text-sm">Loading payment schedule…</p>:milestones.isError?
    <p role="alert" className="text-sm text-destructive">{err(milestones.error)}</p>:
    milestones.data?.length?<div className="overflow-x-auto rounded-lg border">
     <table className="w-full min-w-[480px] text-xs"><thead className="bg-muted/40">
      <tr>{["Milestone","Due","Expected","Credited","Remaining"].map(x=><th key={x} className="p-2 text-left">{x}</th>)}</tr>
     </thead><tbody>{milestones.data.map(m=><tr key={m.sequence} className="border-t">
      <td className="p-2">{m.label}</td><td className="p-2">{m.due_on}</td>
      <td className="p-2">{money(m.expected)}</td><td className="p-2">{money(m.credited)}</td>
      <td className="p-2">{money(m.outstanding)}</td>
     </tr>)}</tbody></table>
    </div>:<p className="text-sm text-muted-foreground">No payment schedule entered yet.</p>}
   {manager&&booking.status!=="cancelled"&&<form className="space-y-2 border-t pt-3"
    onSubmit={e=>{
     e.preventDefault();
     if(Math.abs(total-Number(booking.final_sale_price))>0.005){toast.error("Milestones must total the agreed sale value");return;}
     void run("sales_set_payment_plan",{
      _sale_id:booking.id,_rows:plan,_reason:planReason,
     },"New payment plan version saved",["sales-current-milestones"]);
    }}>
    <p className="text-sm font-semibold">Create revised payment schedule</p>
    {plan.map((m,index)=><div key={index} className="grid grid-cols-[1fr_110px_100px] items-end gap-2">
     <Field label="Milestone"><input className={input} required minLength={2} value={m.label}
      onChange={e=>setPlan(rows=>rows.map((r,i)=>i===index?{...r,label:e.target.value}:r))}/></Field>
     <Field label="Due date"><input className={input} required type="date" value={m.due_on}
      onChange={e=>setPlan(rows=>rows.map((r,i)=>i===index?{...r,due_on:e.target.value}:r))}/></Field>
     <div><Field label="Amount ₹"><input type="number" min=".01" step=".01" className={input} required value={m.amount}
      onChange={e=>setPlan(rows=>rows.map((r,i)=>i===index?{...r,amount:e.target.value}:r))}/></Field>
      <button type="button" className="mt-1 text-xs text-destructive" disabled={plan.length===1}
       onClick={()=>setPlan(rows=>rows.filter((_,i)=>i!==index))}>Remove</button>
     </div>
    </div>)}
    <Button size="sm" type="button" variant="outline" disabled={plan.length>=30}
     onClick={()=>setPlan(rows=>[...rows,{label:"",due_on:today(),amount:""}])}>Add instalment</Button>
    <p className="text-sm">Schedule total: <b>{money(total)}</b> / {money(booking.final_sale_price)}</p>
    <Field label="Reason for plan version"><input className={input} required minLength={5} value={planReason}
     onChange={e=>setPlanReason(e.target.value)}/></Field>
    <Button type="submit" disabled={busy||Math.abs(total-Number(booking.final_sale_price))>0.005}>
     Save new version</Button>
   </form>}
  </div>}
  {section==="legal"&&<form className="space-y-3" onSubmit={e=>{
   e.preventDefault();void run("sales_save_legal_details",{
    _sale_id:booking.id,_agreement_number:lval("agreement_number"),
    _agreement_date:lval("agreement_date")||null,
    _registration_number:lval("registration_number"),
    _registration_date:lval("registration_date")||null,
    _registration_office:lval("registration_office"),_notes:lval("notes"),
   },"Legal milestones saved",["sales-legal-details"]);
  }}>
   {legality.isLoading?<p className="text-sm">Loading legal details…</p>:legality.isError?
    <p role="alert" className="text-sm text-destructive">{err(legality.error)}</p>:<>
    <p className="text-xs text-muted-foreground">
     Record real agreement and registration references. Stage progression checks these dates
     before marking Agreement signed or Registered.
    </p>
    {([["agreement_number","Agreement number","text"],["agreement_date","Agreement signed on","date"],
      ["registration_number","Registration number","text"],["registration_date","Registered on","date"],
      ["registration_office","Registration office","text"]] as const)
     .map(([key,label,type])=><Field key={key} label={label}><input className={input}
      type={type} max={type==="date"?today():undefined} disabled={!manager} value={lval(key)}
      onChange={e=>patch(key,e.target.value,setLegal)}/></Field>)}
    <Field label="Legal notes"><textarea className={input+" min-h-20 py-2"}
     disabled={!manager} value={lval("notes")} onChange={e=>patch("notes",e.target.value,setLegal)}/></Field>
    {manager&&booking.status!=="cancelled"&&<Button type="submit" disabled={busy}>Save agreement details</Button>}
   </>}
  </form>}
  {section==="documents"&&<div className="space-y-3">
   <p className="text-xs text-muted-foreground">Private files. Only staff authorized for this booking's project can open them.</p>
   {documents.isLoading?<p className="text-sm">Loading files…</p>:documents.isError?
    <p role="alert" className="text-sm text-destructive">{err(documents.error)}</p>:
    <div className="space-y-2">
     {documents.data?.map(d=><div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
      <div className="min-w-0"><p className="truncate text-sm">{d.filename}</p>
       <p className="text-xs text-muted-foreground">{docKinds[d.kind as keyof typeof docKinds]??d.kind} · {new Date(d.uploaded_at).toLocaleDateString("en-IN")}</p></div>
      <Button size="sm" variant="outline" onClick={()=>void openFile(d)}>View</Button>
     </div>)}
     {!documents.data?.length&&<p className="text-sm text-muted-foreground">No documents attached.</p>}
    </div>}
   <div className="space-y-2 border-t pt-3">
    <Field label="Document category"><select className={input} value={kind} onChange={e=>setKind(e.target.value as keyof typeof docKinds)}>
     {Object.entries(docKinds).map(([k,v])=><option key={k} value={k}>{v}</option>)}
    </select></Field>
    <Field label="PDF, JPG or PNG (up to 10 MB)">
     <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="block w-full text-sm"
      onChange={e=>setFile(e.target.files?.[0]??null)}/></Field>
    <Button disabled={!file||busy} onClick={()=>void upload()}>{busy?"Uploading…":"Attach private document"}</Button>
   </div>
  </div>}
 </div>;
}

export function SalesCommercialDialog({mode,project,buildings,flat,booking,manager,canImport=manager,
 companyId,actorId,onClose,onSaved}:Props){
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}>
  <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto">
   <DialogHeader>
    <DialogTitle>{mode==="import"?"Excel / CSV flat import":
     mode==="price"?"Revise listed flat price":"Buyer & booking workspace"}</DialogTitle>
    <DialogDescription>{
     mode==="import"?"Validate before importing. Duplicate flats will not be overwritten.":
     mode==="price"?"New listed prices affect future bookings only, not signed transactions.":
     "Keep buyer information, verified collections, instalment plans and legal records together."
    }</DialogDescription>
   </DialogHeader>
   {mode==="import"&&canImport&&<ImportFlats project={project} buildings={buildings}
    onSaved={onSaved} onClose={onClose}/>}
   {mode==="price"&&flat&&manager&&<PriceRevision flat={flat} onSaved={onSaved} onClose={onClose}/>}
   {mode==="buyer"&&booking&&<BookingWorkspace booking={booking}
    manager={manager} companyId={companyId} actorId={actorId} onSaved={onSaved}/>}
  </DialogContent>
 </Dialog>;
}
