import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Building2, CreditCard, Home, Plus, Wallet, ListFilter, Layers3, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";
import { loadCompleteRows } from "@/lib/complete-register";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PageHeader, Loading } from "@/components/erp/common";
import { UNIT_TYPE_LABEL } from "@/lib/format";
import { createDraftUpload } from "@/lib/draft-upload";
import { showDocument } from "@/components/erp/document-viewer";
import { SalesCommercialDialog } from "@/components/erp/sales-commercial";
import { SalesProjectReports } from "@/components/erp/sales-performance";

// Sales has role/project scoped RLS and callable workflows. UI guards never
// substitute for the authorization checks in the database functions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const PAGE_SIZE = 25;
type Tab = "inventory" | "bookings" | "receipts" | "reports";
type Modal = "flat" | "bulk" | "book" | "receipt" | "stage" | "request" | "cancel" | "decline" | "refund" | "history" | "correct";
type Project = { id: string; name: string };
type Building = { id: string; name: string; project_id: string };
type Floor = { id: string; name: string; floor_number: number; building_id: string };
type Unit = {
  id: string; project_id: string; building_id: string; floor_id: string;
  unit_number: string; unit_type: string; carpet_area: number; saleable_area: number;
  ownership_type?:string; legacy_sale_status?:string|null; source_layout?:string|null; pricing_model?:string; stamp_duty_rate?:number; registration_fee?:number;
  status: string; base_rate: number; floor_rise_rate: number; parking_charges: number;
  other_charges: number; gst_rate: number; total_agreement_value: number;
};
type Booking = {
  id: string; sale_number: string; unit_id: string; project_id: string; buyer_name: string;
  buyer_mobile: string; buyer_email: string | null; co_buyer_name: string | null;
  final_sale_price: number; booked_on: string; status: string;
  units: { unit_number: string; building_id: string; floor_id: string; unit_type: string } | null;
};
type Receipt = {
  id: string; sale_id: string; amount: number; paid_on: string; method: string;
  reference: string | null; status: string; reviewer_note: string | null; proof_path:string|null; proof_filename:string|null;
  property_sales: { buyer_name: string; sale_number: string; project_id: string;
    units: { unit_number: string; building_id: string; floor_id: string } | null } | null;
};
type Finance = {
  sale_id: string; verified_paid: number; reported_pending: number; refund_due: number;
  refund_paid: number; cancellation_reason: string | null;
  pending_cancel_request_id: string | null; pending_cancel_reason: string | null;
};
type Summary = {
  total_flats: number; available_flats: number; booked_flats: number; active_sales: number;
  cancelled_sales: number; verified_collections: number; outstanding: number; refund_pending: number;
};
type Page<T> = { rows: T[]; count: number };
type Catalog = { projects: Project[]; buildings: Building[]; floors: Floor[] };
type Filters = { project: string; building: string; floor: string; search: string; status: string; page: number };
const input = "h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm";
const money = (value: number) => new Intl.NumberFormat("en-IN", {
  style: "currency",currency: "INR",maximumFractionDigits: 2,
}).format(Number(value) || 0);
const num = (value: unknown) => Number(value) || 0;
const today = () => new Date().toLocaleDateString("en-CA");
const methods = ["upi","neft","rtgs","imps","cheque","cash","card","other"];
const stages = ["booked","agreement_pending","agreement_done","registered","possession_pending","possession_completed"];
const labels: Record<string,string> = {
  sold:"Sold",landowner:"Landowner flat",investor:"Investor flat",
  third_party:"Landowner / investor",legacy_sold:"Sold (historical)",legacy_booked:"Booked (historical)",available:"Available",hold:"On hold",booked:"Booked",agreement_pending:"Agreement pending",
  agreement_done:"Agreement signed",registered:"Registered",possession_pending:"Possession pending",
  possession_completed:"Possession completed",cancelled:"Cancelled",reported:"Awaiting verification",
  verified:"Verified",rejected:"Rejected",
};

async function all<T extends { id: string }>(table: string, columns: string): Promise<T[]> {
  return loadCompleteRows<T>(async (start,end) => {
    const result = await db.from(table).select(columns,{ count:"exact" }).order("id").range(start,end);
    return {data:result.data as T[] | null,count:result.count as number | null,
      error:result.error as {message:string} | null};
  });
}
async function catalog(): Promise<Catalog> {
  const [projects,buildings,floors] = await Promise.all([
    all<Project>("projects","id,name"),
    all<Building>("buildings","id,name,project_id"),
    all<Floor>("floors","id,name,floor_number,building_id"),
  ]);
  return {projects,buildings,floors};
}
async function listPage<T>(tab: Tab, filter: Filters): Promise<Page<T>> {
  let query;
  if (tab === "inventory") {
    query = db.from("units")
      .select("id,project_id,building_id,floor_id,unit_number,unit_type,carpet_area,saleable_area,status,ownership_type,legacy_sale_status,source_layout,pricing_model,stamp_duty_rate,registration_fee,base_rate,floor_rise_rate,parking_charges,other_charges,gst_rate,total_agreement_value",
        { count:"exact" }).eq("record_status","active");
    if (filter.project) query=query.eq("project_id",filter.project);
    if (filter.building) query=query.eq("building_id",filter.building);
    if (filter.floor) query=query.eq("floor_id",filter.floor);
    if (filter.status==="landowner"||filter.status==="investor") query=query.eq("ownership_type",filter.status);
    else if(filter.status==="sold") query=query.eq("ownership_type","builder").or("legacy_sale_status.eq.sold,and(legacy_sale_status.is.null,status.in.(registered,possession_pending,possession_completed))");
    else if(filter.status==="booked") query=query.eq("ownership_type","builder").or("legacy_sale_status.eq.booked,and(legacy_sale_status.is.null,status.eq.booked)");
    else if(filter.status) query=query.eq("status",filter.status).eq("ownership_type","builder").is("legacy_sale_status",null);
    if (filter.search.trim()) query=query.ilike("unit_number","%"+filter.search.trim().replaceAll("%","\\%").replaceAll("_","\\_")+"%");
    query=query.order("unit_number",{ascending:true}).order("id");
  } else if (tab === "bookings") {
    query=db.from("property_sales")
      .select("id,sale_number,unit_id,project_id,buyer_name,buyer_mobile,buyer_email,co_buyer_name,final_sale_price,booked_on,status,units!inner(unit_number,building_id,floor_id,unit_type)",
        {count:"exact"});
    if (filter.project) query=query.eq("project_id",filter.project);
    if (filter.building) query=query.eq("units.building_id",filter.building);
    if (filter.floor) query=query.eq("units.floor_id",filter.floor);
    if (filter.status) query=query.eq("status",filter.status);
    if (filter.search.trim()) {
      const term=filter.search.trim().replace(/[,().%*\\:"']/g," ").replace(/\s+/g," ").slice(0,80);
      const units=await db.from("units").select("id",{count:"exact"})
        .eq("record_status","active").ilike("unit_number","%"+term+"%")
        .order("id").limit(500);
      if (units.error) throw units.error;
      if ((units.count??0)>500) throw new Error("Too many matching flats. Search a longer flat number.");
      const ids=(units.data??[]).map((u:{id:string})=>u.id);
      query=query.or([
        "buyer_name.ilike.%"+term+"%",
        "buyer_mobile.ilike.%"+term+"%",
        "sale_number.ilike.%"+term+"%",
        ...(ids.length?["unit_id.in.("+ids.join(",")+")"]:[]),
      ].join(","));
    }
    query=query.order("booked_on",{ascending:false}).order("id",{ascending:false});
  } else {
    query=db.from("property_sale_receipts")
      .select("id,sale_id,amount,paid_on,method,reference,status,reviewer_note,proof_path,proof_filename,property_sales!inner(buyer_name,sale_number,project_id,units!inner(unit_number,building_id,floor_id))",
        {count:"exact"});
    if (filter.project) query=query.eq("property_sales.project_id",filter.project);
    if (filter.building) query=query.eq("property_sales.units.building_id",filter.building);
    if (filter.floor) query=query.eq("property_sales.units.floor_id",filter.floor);
    if (filter.status) query=query.eq("status",filter.status);
    if (filter.search.trim()) {
      const term=filter.search.trim().replace(/[,().%*\\:"']/g," ").replace(/\s+/g," ").slice(0,80);
      const sales=await db.from("property_sales").select("id",{count:"exact"})
        .or("buyer_name.ilike.%"+term+"%,buyer_mobile.ilike.%"+term+"%,sale_number.ilike.%"+term+"%")
        .order("id").limit(500);
      if (sales.error) throw sales.error;
      if ((sales.count??0)>500) throw new Error("Too many matching buyers. Search a longer name or booking number.");
      const ids=(sales.data??[]).map((u:{id:string})=>u.id);
      query=query.or([
        "reference.ilike.%"+term+"%",
        ...(ids.length?["sale_id.in.("+ids.join(",")+")"]:[]),
      ].join(","));
    }
    query=query.order("created_at",{ascending:false}).order("id",{ascending:false});
  }
  const result=await query.range(filter.page*PAGE_SIZE,filter.page*PAGE_SIZE+PAGE_SIZE-1);
  if (result.error) throw result.error;
  return {rows:(result.data ?? []) as T[],count:result.count ?? 0};
}
async function call(name:string,args:Record<string,unknown>) {
  const result=await db.rpc(name,args);
  if (result.error) throw result.error;
  return result.data;
}
function Field({label,children}:{label:string;children:ReactNode}) {
  return <label className="block min-w-0 space-y-1.5 text-xs font-semibold text-muted-foreground">
    <span>{label}</span>{children}
  </label>;
}
function Status({value}:{value:string}) {
  const cls=value==="cancelled"||value==="rejected"?"border-red-500/30 text-red-700":
    value==="available"||value==="verified"?"border-emerald-500/30 text-emerald-700":"";
  return <span className={"inline-flex rounded-lg border bg-muted/30 px-2 py-1 text-[11px] font-medium "+cls}>
    {labels[value] ?? value}
  </span>;
}
function Pager({count,page,onChange}:{count:number;page:number;onChange:(next:number)=>void}) {
  const pages=Math.max(1,Math.ceil(count/PAGE_SIZE));
  return <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
    <span>{count ? `${page*PAGE_SIZE+1}–${Math.min(count,(page+1)*PAGE_SIZE)} of ${count}` : "No records"}</span>
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={page===0} onClick={()=>onChange(page-1)}>Previous</Button>
      <span className="tabular-nums">{page+1} / {pages}</span>
      <Button size="sm" variant="outline" disabled={page+1>=pages} onClick={()=>onChange(page+1)}>Next</Button>
    </div>
  </div>;
}
const emptySummary:Summary={
  total_flats:0,available_flats:0,booked_flats:0,active_sales:0,cancelled_sales:0,
  verified_collections:0,outstanding:0,refund_pending:0,
};
export function SalesPage({initialTab="inventory",initialProject=""}:{initialTab?:Tab;initialProject?:string}={}) {
  const me=useMe(),qc=useQueryClient();
  const manager=!!me.data?.roles.some(r=>r==="super_admin"||r==="director");
  const scopedSales=!!me.data?.roles.some(r=>r==="ceo"||r==="senior_sales_executive");
  const canCreateFlats=manager&&!scopedSales;
  const superAdmin=!!me.data?.roles.includes("super_admin");
  const [tab,setTab]=useState<Tab>(initialTab);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [project,setProject]=useState(initialProject);
  const [building,setBuilding]=useState("");
  const [floor,setFloor]=useState("");
  const [status,setStatus]=useState("");
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(0);
  const [modal,setModal]=useState<Modal|null>(null);
  const [commercial,setCommercial]=useState<{mode:"import"|"price"|"buyer";flat?:Unit;booking?:Booking}|null>(null);
  const [flat,setFlat]=useState<Unit|null>(null);
  const [sale,setSale]=useState<Booking|null>(null);
  const [selectedFloors,setSelectedFloors]=useState<string[]>([]);
  const [form,setForm]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [proof,setProof]=useState<File|null>(null);
  const [receiptUpload]=useState(()=>createDraftUpload<File>());
  const value=(key:string)=>form[key]??"";
  const put=(key:string,v:string)=>setForm(x=>({...x,[key]:v}));
  const filter={project,building,floor,status,search,page};
  const meta=useQuery({queryKey:["sales-catalog",me.data?.profile.id],queryFn:catalog,enabled:!!me.data?.profile.id});
  const summary=useQuery({
    queryKey:["sales-overview",project,building,me.data?.profile.id],
    enabled:!!me.data?.profile.id,
    queryFn:async()=>await call("sales_overview",{_project:project||null,_building:building||null}) as Summary,
  });
  const listing=useQuery({
    queryKey:["sales-register",tab,filter,me.data?.profile.id],
    enabled:!!me.data?.profile.id&&tab!=="reports",
    queryFn:()=>listPage<Unit|Booking|Receipt>(tab,filter),
  });
  const bookings=tab==="bookings" ? (listing.data?.rows ?? []) as Booking[] : [];
  const salesIds=bookings.map(x=>x.id);
  const financeQuery=useQuery({
    queryKey:["sales-booking-finances",salesIds],
    enabled:tab==="bookings"&&salesIds.length>0,
    queryFn:async()=>await call("sales_booking_finances",{_sale_ids:salesIds}) as Finance[],
  });
  const finances=useMemo(()=>new Map((financeQuery.data??[]).map(x=>[x.sale_id,x])),[financeQuery.data]);
  const chosenFinance=sale?finances.get(sale.id):undefined;
  const events=useQuery({
    queryKey:["sales-events",sale?.id],
    enabled:modal==="history"&&!!sale?.id,
    queryFn:async()=>{
      const result=await db.from("property_sale_events")
        .select("id,action,details,created_at,actor_id")
        .eq("sale_id",sale!.id).order("created_at",{ascending:false}).limit(150);
      if(result.error) throw result.error;
      return (result.data??[]) as {id:string;action:string;details:Record<string,unknown>;created_at:string;actor_id:string}[];
    },
  });
  const summaryData=summary.data??emptySummary;
  const projectNames=useMemo(()=>new Map(meta.data?.projects.map(x=>[x.id,x.name])),[meta.data]);
  const buildingNames=useMemo(()=>new Map(meta.data?.buildings.map(x=>[x.id,x.name])),[meta.data]);
  const floors=meta.data?.floors??[];
  const buildings=(meta.data?.buildings??[]).filter(x=>!project||x.project_id===project).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  const floorOptions=floors.filter(x=>x.building_id===building).sort((a,b)=>a.floor_number-b.floor_number);
  const creationBuildings=(meta.data?.buildings??[]).filter(x=>x.project_id===value("project_id"));
  const creationFloors=floors.filter(x=>x.building_id===value("building_id"))
    .sort((a,b)=>a.floor_number-b.floor_number);
  const total=listing.data?.count??0;
  const filterCount=[project,building,floor,status].filter(Boolean).length;
  const compactFilter="h-10 w-full min-w-0 rounded-md border bg-background px-2 text-base lg:h-9 lg:w-auto lg:max-w-[165px] lg:text-xs";
  const changeTab=(next:Tab)=>{setTab(next);setStatus("");setSearch("");setPage(0);};
  const update=async(name:string,args:Record<string,unknown>,message:string)=>{
    if(busy)return;
    setBusy(true);
    try {
      if(name==="sales_report_receipt_with_proof"){
        const actor=me.data?.profile.id,company=me.data?.profile.company_id;
        if(!proof||!sale||!actor||!company)throw new Error("Attach payment proof before recording.");
        const ext=proof.name.toLowerCase().split(".").pop()??"";
        const types:Record<string,string>={pdf:"application/pdf",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png"};
        if(!types[ext]||proof.type!==types[ext]||proof.size<1||proof.size>10*1024*1024)throw new Error("Select a PDF, JPG or PNG up to 10 MB.");
        const path=await receiptUpload.get(proof,JSON.stringify([actor,company,sale.id]),async file=>{
          const key=company+"/"+sale.id+"/"+actor+"/"+crypto.randomUUID()+"."+ext;
          const r=await supabase.storage.from("sales-documents").upload(key,file,{contentType:file.type,upsert:false});
          if(r.error)throw r.error;
          return key;
        });
        args={...args,_proof_path:path,_filename:proof.name.slice(0,150)};
      }
      const result=await call(name,args);
      receiptUpload.clear();setProof(null);
      toast.success(message);
      setModal(null);
      setSale(null);
      setFlat(null);
      await Promise.all([
        qc.invalidateQueries({queryKey:["sales-register"]}),
        qc.invalidateQueries({queryKey:["sales-overview"]}),
        qc.invalidateQueries({queryKey:["sales-booking-finances"]}),
        qc.invalidateQueries({queryKey:["sales-events"]}),
        qc.invalidateQueries({queryKey:["units"]}),
      ]);
      return result;
    }catch(error) {
      toast.error(error instanceof Error?error.message:String(error));
    }finally{setBusy(false);}
  };
  const submit=(e:FormEvent<HTMLFormElement>,name:string,args:Record<string,unknown>,message:string)=>{
    e.preventDefault();void update(name,args,message);
  };
  function openUnit(){setForm({project_id:project,building_id:building,floor_id:floor,type:"2bhk",parking:"0",other:"0",gst:"5"});setModal("flat");}
  function openBulk(){
    setSelectedFloors([]);
    setForm({project_id:project,building_id:building,type:"2bhk",per_floor:"4",start_at:"1",digits:"2",separator:"",parking:"0",other:"0",gst:"5"});
    setModal("bulk");
  }
  function openBook(unit:Unit){setFlat(unit);setForm({price:String(unit.total_agreement_value),booked_on:today()});setModal("book");}
  function openSale(item:Booking,type:Modal){
    setSale(item);
    setProof(null);receiptUpload.clear();
    setForm(type==="receipt"?{method:"upi",paid_on:today()}:
      type==="refund"?{method:"upi",refunded_on:today()}:
      type==="cancel"?{reason:finances.get(item.id)?.pending_cancel_reason??"",fee:"0"}:{});
    setModal(type);
  }
  const filteredStatus=tab==="inventory"?["available","sold","booked","landowner","investor","hold","agreement_pending","agreement_done","cancelled"]:
    tab==="bookings"?[...stages,"cancelled"]:tab==="receipts"?["reported","verified","rejected"]:[];
  const financeReady=tab!=="bookings"||salesIds.length===0||financeQuery.isSuccess;
  const ready=tab!=="reports"&&meta.isSuccess&&listing.isSuccess&&financeReady;
  const candidateCount=selectedFloors.length*Math.max(0,Number(value("per_floor"))||0);
  const firstSelected=creationFloors.find(x=>selectedFloors.includes(x.id));
  const firstExample=firstSelected?`${firstSelected.floor_number}${value("separator")}${String(Number(value("start_at"))||0).padStart(Number(value("digits"))||2,"0")}`:"—";

  return <div className="min-w-0 space-y-4 pb-10">
    <PageHeader title={me.data?.roles.includes("ceo")?"CEO Sales Portal":scopedSales?"Senior Sales Portal":"Sales & Bookings"}
      subtitle="Project-wise property inventory, customer bookings, collections and cancellations" />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
      {([
        ["Total flats",String(summaryData.total_flats),Layers3],
        ["Available / unsold",String(summaryData.available_flats),Home],
        ["Booked / sales in progress",String(summaryData.active_sales),Building2],
        ["Verified collections",money(summaryData.verified_collections),CreditCard],
        ["Buyer outstanding",money(summaryData.outstanding),Wallet],
        ["Refunds pending",money(summaryData.refund_pending),RotateCcw],
      ] as const).map(([label,value,Icon])=>
        <section key={label} className="rounded-xl border bg-card p-3.5">
          <Icon className="mb-1 h-4 w-4 text-primary"/>
          <p className="break-words text-lg font-bold tabular-nums">{summary.isSuccess?value:"—"}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </section>)}
    </div>
    <div className="min-w-0 space-y-2" data-sales-filter-toolbar>
      {canCreateFlats&&<div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={()=>setCommercial({mode:"import"})}>Import</Button>
        <Button size="sm" variant="outline" onClick={openBulk}>Bulk add</Button>
        <Button size="sm" onClick={openUnit}><Plus className="mr-1 h-4 w-4"/>Add flat</Button>
      </div>}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <input aria-label="Search records" className="h-10 min-w-[120px] flex-1 rounded-md border bg-background px-2 text-base lg:h-9 lg:max-w-[210px] lg:text-xs" value={search}
          placeholder={tab==="inventory"?"Search flat no.":tab==="bookings"?"Buyer / booking":"Search collection"} onChange={e=>{setSearch(e.target.value);setPage(0);}}/>
        <Button size="sm" variant="outline" className="h-10 shrink-0 lg:hidden" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(v=>!v)}><ListFilter className="mr-1 h-4 w-4"/>Filters{filterCount?` (${filterCount})`:""}</Button>
        <div className={"w-full grid-cols-2 gap-1.5 lg:flex lg:w-auto lg:flex-wrap lg:items-center "+(filtersOpen?"grid":"hidden")}>
          <select aria-label="Select project" className={compactFilter} value={project} onChange={e=>{setProject(e.target.value);setBuilding("");setFloor("");setPage(0);}}><option value="">All projects</option>{meta.data?.projects.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select aria-label="Select wing or building" className={compactFilter} value={building} onChange={e=>{setBuilding(e.target.value);setFloor("");setPage(0);}}><option value="">All wings</option>{buildings.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select aria-label="Select floor" className={compactFilter} value={floor} disabled={!building} onChange={e=>{setFloor(e.target.value);setPage(0);}}><option value="">{building?"All floors":"Select wing"}</option>{floorOptions.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select aria-label="Filter by status" className={compactFilter} value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}><option value="">All statuses</option>{filteredStatus.map(x=><option key={x} value={x}>{labels[x]}</option>)}</select>
        </div>
        {(filterCount>0||search)&&<Button size="sm" variant="ghost" className="shrink-0 px-2" aria-label="Clear filters" onClick={()=>{setProject("");setBuilding("");setFloor("");setStatus("");setSearch("");setPage(0);}}>Clear</Button>}
      </div>
      {(floor||status)&&<p className="text-[11px] text-muted-foreground">Summary: project / wing totals · List: selected floor and status.</p>}
    </div>
    <div role="tablist" aria-label="Sales sections" className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
      {([["inventory","Flat inventory"],["bookings","Bookings"],["receipts","Collections"],["reports","Project reports"]] as const)
        .map(([key,title])=><button type="button" key={key} role="tab" aria-selected={tab===key}
          onClick={()=>changeTab(key)}
          className={"min-h-10 shrink-0 rounded-lg px-4 text-sm font-medium "+(tab===key?"bg-card shadow-sm":"text-muted-foreground")}>
          {title}</button>)}
    </div>
    {(meta.isLoading||listing.isLoading||(!financeReady&&!financeQuery.isError))&&<Loading/>}
    {(meta.isError||listing.isError||summary.isError||financeQuery.isError)&&
      <section role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
        Unable to load sales: {String(meta.error?.message??listing.error?.message??summary.error?.message??financeQuery.error?.message)}
        <Button size="sm" variant="outline" className="ml-2" onClick={()=>{void meta.refetch();void listing.refetch();void summary.refetch();if(financeQuery.isError)void financeQuery.refetch();}}>Retry</Button>
      </section>}
    {tab==="reports"&&<SalesProjectReports project={project} building={building}/>}
    {ready&&<section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <p className="text-sm font-semibold">{tab==="inventory"?"Flat register":tab==="bookings"?"Buyer booking register":"Receipt register"}</p>
        <p className="text-xs text-muted-foreground">{total} matching records · {PAGE_SIZE} per page</p>
      </div>
      <div className="overflow-x-auto">
        {tab==="inventory"&&<div className="divide-y md:hidden" data-mobile-sales-inventory>
          {(listing.data?.rows as Unit[]).map(u=><div key={u.id} className={"flex min-w-0 items-center gap-2 px-3 py-2.5 "+(u.ownership_type&&u.ownership_type!=="builder"?"bg-red-50 dark:bg-red-950/40":"")}>
            <div className="min-w-0 flex-1"><p className="font-semibold">{u.unit_number} <span className="text-xs font-normal text-muted-foreground">{u.source_layout?.startsWith("1-RK")?"1 RK":UNIT_TYPE_LABEL[u.unit_type as keyof typeof UNIT_TYPE_LABEL]??u.unit_type}</span></p><p className="truncate text-[11px] text-muted-foreground">{buildingNames.get(u.building_id)} · {floors.find(f=>f.id===u.floor_id)?.name}</p><p className="text-xs tabular-nums">{money(num(u.total_agreement_value))}</p></div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">{u.ownership_type&&u.ownership_type!=="builder"?<span className="rounded border border-red-300 bg-red-100 px-2 py-1 text-[11px] font-semibold text-red-800 dark:bg-red-950 dark:text-red-200">{u.ownership_type==="investor"?"Investor":"Landowner"}</span>:u.legacy_sale_status?<Status value={u.legacy_sale_status}/>:<Status value={["registered","possession_pending","possession_completed"].includes(u.status)?"sold":u.status}/>}
             {u.status==="available"&&(!u.ownership_type||u.ownership_type==="builder")&&!u.legacy_sale_status&&<Button size="sm" className="h-9 px-2" onClick={()=>openBook(u)}>Book</Button>}
             {manager&&u.status==="available"&&(!u.ownership_type||u.ownership_type==="builder")&&!u.legacy_sale_status&&<Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={()=>setCommercial({mode:"price",flat:u})}>Revise price</Button>}
            </div>
          </div>)}
        </div>}
        {tab==="inventory"&&<table className="hidden w-full min-w-[850px] text-left text-sm md:table">
          <thead className="bg-muted/40 text-xs text-muted-foreground"><tr>
            {["Project / Building","Flat / Floor","Type / Area","Rate / Agreement value","Status","Action"].map(x=>
              <th key={x} className="px-3 py-3 font-medium">{x}</th>)}
          </tr></thead>
          <tbody className="divide-y">
            {(listing.data?.rows as Unit[]).map(u=><tr key={u.id} className={u.ownership_type&&u.ownership_type!=="builder"?"bg-red-50 dark:bg-red-950/40":""}>
              <td className="px-3 py-3"><strong>{projectNames.get(u.project_id)??"—"}</strong>
                <p className="text-xs text-muted-foreground">{buildingNames.get(u.building_id)??"—"}</p></td>
              <td className="px-3 py-3"><strong>{u.unit_number}</strong>
                <p className="text-xs text-muted-foreground">{floors.find(f=>f.id===u.floor_id)?.name??"—"}</p></td>
              <td className="px-3 py-3">{u.source_layout?.startsWith("1-RK")?"1 RK":UNIT_TYPE_LABEL[u.unit_type as keyof typeof UNIT_TYPE_LABEL]??u.unit_type}
                <p className="text-xs text-muted-foreground">{u.saleable_area} sqft</p></td>
              <td className="px-3 py-3 tabular-nums">{money(num(u.total_agreement_value))}
                <p className="text-xs text-muted-foreground">{money(num(u.base_rate))}/sqft</p></td>
              <td className="px-3 py-3">{u.ownership_type&&u.ownership_type!=="builder"?<span className="rounded-full border border-red-300 bg-red-100 px-2 py-1 text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-200">{u.ownership_type==="investor"?"Investor flat":"Landowner flat"}</span>:u.legacy_sale_status?<span className="text-xs font-semibold">{u.legacy_sale_status==="sold"?"Sold":"Booked"}</span>:<Status value={["registered","possession_pending","possession_completed"].includes(u.status)?"sold":u.status}/>}</td>
              <td className="px-3 py-3"><div className="flex gap-2">{u.status==="available"&&(!u.ownership_type||u.ownership_type==="builder")&&!u.legacy_sale_status&&<>
                <Button size="sm" onClick={()=>openBook(u)}>Book flat</Button>
                {manager&&<Button size="sm" variant="outline"
                 onClick={()=>setCommercial({mode:"price",flat:u})}>Revise price</Button>}
              </>}</div></td>
            </tr>)}
          </tbody>
        </table>}
        {tab==="bookings"&&<table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground"><tr>
            {["Booking / Buyer","Project / Flat","Stage","Agreed value","Collected / Due","Cancellation / Refund","Actions"].map(x=>
              <th key={x} className="px-3 py-3 font-medium">{x}</th>)}
          </tr></thead>
          <tbody className="divide-y">
            {bookings.map(b=>{
              const f=finances.get(b.id);
              const paid=num(f?.verified_paid),due=Math.max(0,num(b.final_sale_price)-paid);
              const refundOutstanding=Math.max(0,num(f?.refund_due)-num(f?.refund_paid));
              return <tr key={b.id}>
                <td className="px-3 py-3"><strong>{b.buyer_name}</strong>
                  <p className="text-xs text-muted-foreground">{b.sale_number}</p>
                  <p className="text-xs text-muted-foreground">{b.buyer_mobile}</p></td>
                <td className="px-3 py-3">{projectNames.get(b.project_id)??"—"}
                  <p className="text-xs text-muted-foreground">
                    {buildingNames.get(b.units?.building_id??"")??"—"} · Flat {b.units?.unit_number??"—"}
                  </p></td>
                <td className="px-3 py-3"><Status value={b.status}/>
                  <p className="mt-1 text-xs text-muted-foreground">{b.booked_on}</p></td>
                <td className="px-3 py-3 tabular-nums">{money(num(b.final_sale_price))}</td>
                <td className="px-3 py-3 tabular-nums">{money(paid)}
                  <p className="text-xs text-muted-foreground">{b.status==="cancelled"?"Historic collection":"Due "+money(due)}</p>
                  {num(f?.reported_pending)>0&&<p className="text-xs text-amber-700">Pending {money(num(f?.reported_pending))}</p>}</td>
                <td className="px-3 py-3">
                  {f?.pending_cancel_request_id&&<p className="text-xs font-medium text-amber-700">Cancellation requested</p>}
                  {b.status==="cancelled"?<>
                    <p className="text-xs">Refund due {money(num(f?.refund_due))}</p>
                    <p className="text-xs text-muted-foreground">Remaining {money(refundOutstanding)}</p>
                  </>:<span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-3"><div className="flex max-w-64 flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={()=>setCommercial({mode:"buyer",booking:b})}>Buyer file</Button>
                  <Button size="sm" variant="outline" onClick={()=>openSale(b,"history")}>History</Button>
                  {b.status!=="cancelled"&&b.status!=="possession_completed"&&
                    num(b.final_sale_price)>paid&&<Button size="sm" onClick={()=>openSale(b,"receipt")}>Payment</Button>}
                  {manager&&b.status!=="cancelled"&&b.status!=="possession_completed"&&
                    <Button size="sm" variant="outline" onClick={()=>openSale(b,"stage")}>Next stage</Button>}
                  {superAdmin&&["agreement_pending","agreement_done","registered","possession_pending"].includes(b.status)
                    &&paid===0&&num(f?.reported_pending)===0&&
                    <Button size="sm" variant="outline" onClick={()=>openSale(b,"correct")}>Correct wrong stage</Button>}
                  {["booked","agreement_pending"].includes(b.status)&&
                    (manager?<Button size="sm" variant="destructive" onClick={()=>openSale(b,"cancel")}>Cancel booking</Button>:
                      !f?.pending_cancel_request_id&&<Button size="sm" variant="outline" onClick={()=>openSale(b,"request")}>Request cancellation</Button>)}
                  {manager&&f?.pending_cancel_request_id&&
                    <Button size="sm" variant="outline" onClick={()=>openSale(b,"decline")}>Decline request</Button>}
                  {manager&&b.status==="cancelled"&&refundOutstanding>0&&
                    <Button size="sm" onClick={()=>openSale(b,"refund")}>Record refund</Button>}
                </div></td>
              </tr>;
            })}
          </tbody>
        </table>}
        {tab==="receipts"&&<table className="w-full min-w-[850px] text-left text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground"><tr>
            {["Buyer / Booking","Date","Amount","Method / Reference","Status","Review"].map(x=>
              <th key={x} className="px-3 py-3 font-medium">{x}</th>)}
          </tr></thead>
          <tbody className="divide-y">
            {(listing.data?.rows as Receipt[]).map(r=><tr key={r.id}>
              <td className="px-3 py-3"><strong>{r.property_sales?.buyer_name??"—"}</strong>
                <p className="text-xs text-muted-foreground">{r.property_sales?.sale_number}</p></td>
              <td className="px-3 py-3">{r.paid_on}</td>
              <td className="px-3 py-3 font-semibold">{money(num(r.amount))}</td>
              <td className="px-3 py-3">{r.method.toUpperCase()}
                <p className="text-xs text-muted-foreground">{r.reference??"—"}</p></td>
              <td className="px-3 py-3"><Status value={r.status}/>
                {r.reviewer_note&&<p className="text-xs text-muted-foreground">{r.reviewer_note}</p>}</td>
              <td className="px-3 py-3">{r.proof_path?<Button size="sm" variant="outline" onClick={async()=>{try{const result=await supabase.storage.from("sales-documents").download(r.proof_path!);if(result.error)throw result.error;showDocument({url:URL.createObjectURL(result.data),type:result.data.type||"application/pdf",name:r.proof_filename||"Payment proof"});}catch(e){toast.error(e instanceof Error?e.message:String(e));}}}>View proof</Button>:<span className="text-xs text-muted-foreground">Legacy / no proof</span>}{manager&&r.status==="reported"&&<div className="flex gap-2">
                <Button disabled={busy} size="sm" onClick={()=>void update("sales_review_receipt",
                  {_receipt_id:r.id,_approve:true},"Receipt verified")}>Verify</Button>
                <Button disabled={busy} size="sm" variant="outline" onClick={()=>{
                  const reason=window.prompt("Reason for rejecting this receipt:");
                  if(reason?.trim())void update("sales_review_receipt",
                    {_receipt_id:r.id,_approve:false,_note:reason},"Receipt rejected");
                }}>Reject</Button>
              </div>}</td>
            </tr>)}
          </tbody>
        </table>}
        {listing.data?.rows.length===0&&<p className="p-8 text-center text-sm text-muted-foreground">
          No matching records. Change filters or {manager&&tab==="inventory"?"bulk-create flats for the selected building.":"check the selected project."}
        </p>}
      </div>
      <Pager count={total} page={page} onChange={setPage}/>
    </section>}
    {commercial&&<SalesCommercialDialog key={commercial.mode+(commercial.booking?.id??commercial.flat?.id??"")}
      mode={commercial.mode} project={project} buildings={meta.data?.buildings??[]}
      flat={commercial.flat} booking={commercial.booking} manager={manager} canImport={canCreateFlats}
      companyId={me.data?.profile.company_id??""} actorId={me.data?.profile.id??""}
      onClose={()=>setCommercial(null)} onSaved={()=>{
        for(const key of ["sales-register","sales-overview","sales-project-commercial-report",
          "sales-booking-finances","units"])void qc.invalidateQueries({queryKey:[key]});
      }}/>}
    <Dialog open={modal!==null} onOpenChange={open=>{if(!open&&!busy)setModal(null);}}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{({
            flat:"Add individual flat",bulk:"Bulk-create flats",book:"Book flat "+(flat?.unit_number??""),
            receipt:"Record buyer payment",stage:"Advance booking stage",
            request:"Request cancellation",cancel:"Cancel booking",decline:"Decline cancellation request",
            refund:"Record customer refund",history:"Booking activity & history",
            correct:"Correct an erroneously advanced booking",
          } as Record<Modal,string>)[modal??"flat"]}</DialogTitle>
          <DialogDescription>{
            modal==="cancel"?"This action releases the flat. Existing verified payments stay in the ledger and any refund due remains payable.":
            modal==="bulk"?"Generate flats across selected floors within one building. Duplicate numbers reject the entire batch.":
            modal==="refund"?"Record a refund only after money has actually been returned. This does not initiate a bank transfer.":
            modal==="history"?"Activity is append-only and retains the previous buyer's cancellation history.":
            modal==="correct"?"Super Admin-only clerical correction; not a legal agreement, registration or possession reversal.":
            "Actions are checked against company, project and role permissions."
          }</DialogDescription>
        </DialogHeader>
        {canCreateFlats&&(modal==="flat"||modal==="bulk")&&<form className="space-y-3" onSubmit={e=>submit(e,modal==="flat"?"sales_add_flat":"sales_bulk_add_flats",
          modal==="flat"?{
            _floor_id:value("floor_id"),_number:value("number").trim(),_type:value("type"),
            _carpet:Number(value("carpet")),_built_up:Number(value("built_up")),_saleable:Number(value("saleable")),
            _rate:Number(value("rate")),_parking:Number(value("parking")),_other:Number(value("other")),
            _gst:Number(value("gst")),
          }:{
            _building_id:value("building_id"),_floor_ids:selectedFloors,
            _per_floor:Number(value("per_floor")),_start_at:Number(value("start_at")),
            _digits:Number(value("digits")),_separator:value("separator"),_type:value("type"),
            _carpet:Number(value("carpet")),_built_up:Number(value("built_up")),_saleable:Number(value("saleable")),
            _rate:Number(value("rate")),_parking:Number(value("parking")),_other:Number(value("other")),
            _gst:Number(value("gst")),
          },modal==="flat"?"Flat created":"Flat batch created")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project *"><select required className={input} value={value("project_id")} onChange={e=>{
              setForm(x=>({...x,project_id:e.target.value,building_id:"",floor_id:""}));setSelectedFloors([]);
            }}>
              <option value="">Select project</option>{meta.data?.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select></Field>
            <Field label="Building / tower *"><select required className={input} value={value("building_id")} onChange={e=>{
              setForm(x=>({...x,building_id:e.target.value,floor_id:""}));setSelectedFloors([]);
            }}>
              <option value="">Select building</option>{creationBuildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select></Field>
          </div>
          {modal==="flat"?
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Floor *"><select required className={input} value={value("floor_id")}
                onChange={e=>put("floor_id",e.target.value)}>
                <option value="">Select floor</option>{creationFloors.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
              </select></Field>
              <Field label="Flat number *"><input required maxLength={50} className={input}
                value={value("number")} onChange={e=>put("number",e.target.value)}/></Field>
            </div>:
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Select floors in this building *</p>
              <div className="flex items-center gap-2 text-xs">
                <Button type="button" size="sm" variant="outline" disabled={!creationFloors.length}
                  onClick={()=>setSelectedFloors(creationFloors.map(f=>f.id))}>Select all</Button>
                <Button type="button" size="sm" variant="outline" onClick={()=>setSelectedFloors([])}>Clear</Button>
                <span>{selectedFloors.length} floors selected</span>
              </div>
              <div className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto rounded-lg border p-2 sm:grid-cols-3">
                {creationFloors.map(f=><label key={f.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={selectedFloors.includes(f.id)}
                    onChange={e=>setSelectedFloors(prev=>e.target.checked?[...prev,f.id]:prev.filter(x=>x!==f.id))}/>
                  {f.name}</label>)}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {([["per_floor","Flats per floor"],["start_at","First flat suffix"],["digits","Suffix digits"],["separator","Separator (optional)"]] as const).map(([key,label])=>
                  <Field key={key} label={label}><input className={input} type={key==="separator"?"text":"number"}
                    min={key==="per_floor"||key==="digits"?1:0}
                    max={key==="per_floor"?50:key==="digits"?4:undefined}
                    required={key!=="separator"} value={value(key)}
                    onChange={e=>put(key,e.target.value)}/></Field>)}
              </div>
              <p className="rounded-lg bg-muted p-3 text-sm">
                Preview: <b>{candidateCount} flats</b> · first example <b>{firstExample}</b>.
                Names follow floor number + separator + padded suffix, e.g. 101, 102, 201.
              </p>
            </div>}
          <Field label="Type *"><select className={input} value={value("type")} onChange={e=>put("type",e.target.value)}>
            {Object.entries(UNIT_TYPE_LABEL).map(([key,label])=><option key={key} value={key}>{label}</option>)}
          </select></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["carpet","Carpet area (sqft)"],["built_up","Built-up area (sqft)"],
              ["saleable","Saleable area (sqft)"],["rate","Base rate (₹/sqft)"],
              ["parking","Parking charges (₹)"],["other","Other charges (₹)"],["gst","GST %"]] as const)
              .map(([key,label])=><Field key={key} label={label}><input className={input}
                required={["carpet","built_up","saleable","rate"].includes(key)}
                min="0" max={key==="gst"?28:undefined} step=".01" type="number" value={value(key)}
                onChange={e=>put(key,e.target.value)}/></Field>)}
          </div>
          <Button type="submit" disabled={busy||(modal==="bulk"&&(candidateCount<1||candidateCount>1200))}
            className="w-full">{busy?"Saving…":modal==="bulk"?`Create ${candidateCount} flats`:"Create flat"}</Button>
        </form>}
        {modal==="book"&&flat&&<form className="space-y-3" onSubmit={e=>submit(e,"sales_book_flat_with_terms",{
          _unit_id:flat.id,_name:value("buyer_name"),_mobile:value("buyer_mobile"),
          _price:Number(value("price")),_booked_on:value("booked_on"),_email:value("buyer_email")||null,
          _co_buyer:value("co_buyer")||null,_notes:value("notes")||null,
          _rate:value("agreed_rate")?Number(value("agreed_rate")):null,_basis:value("agreed_rate")?value("rate_basis")||"saleable":null,
          _amenities:value("amenities"),_bonus:value("bonus"),_referral:value("referral"),
        },"Booking recorded")}>
          <p className="rounded-lg bg-muted p-3 text-sm">List price <b>{money(num(flat.total_agreement_value))}</b></p>
          {([["buyer_name","Buyer name","text",true],["buyer_mobile","Mobile","tel",true],
            ["buyer_email","Email","email",false],["co_buyer","Co-buyer","text",false],
            ["price","Final agreed price (₹)","number",true],["booked_on","Booking date","date",true]] as const)
            .map(([key,label,type,required])=><Field key={key} label={label}><input className={input}
              type={type} required={required} min={type==="number"?1:undefined}
              max={type==="date"?today():undefined} step={type==="number"?".01":undefined}
              value={value(key)} onChange={e=>put(key,e.target.value)}/></Field>)}
          <Field label="Notes"><textarea className={input+" min-h-20 py-2"} value={value("notes")}
            onChange={e=>put("notes",e.target.value)}/></Field>
          <Field label="Agreed rate (₹/sqft)"><input type="number" min=".01" step=".01" className={input} value={value("agreed_rate")} onChange={e=>put("agreed_rate",e.target.value)}/></Field>
          <Field label="Rate area basis"><select className={input} value={value("rate_basis")||"saleable"} onChange={e=>put("rate_basis",e.target.value)}><option value="saleable">Saleable</option><option value="carpet">Carpet</option><option value="built_up">Built-up</option></select></Field>
          {([["amenities","Amenities granted"],["bonus","Complimentary items / bonus"],["referral","Referral details"]] as const).map(([key,label])=><Field key={key} label={label}><textarea maxLength={2000} className={input+" min-h-20 py-2"} value={value(key)} onChange={e=>put(key,e.target.value)}/></Field>)}
          <Button className="w-full" disabled={busy} type="submit">Confirm booking</Button>
        </form>}
        {modal==="receipt"&&sale&&<form className="space-y-3" onSubmit={e=>submit(e,"sales_report_receipt_with_proof",{
          _sale_id:sale.id,_amount:Number(value("amount")),_paid_on:value("paid_on"),
          _method:value("method"),_reference:value("reference")||null,
          _payer:value("payer")||null,_notes:value("notes")||null,
        },"Payment submitted for verification")}>
          <p className="rounded-lg bg-muted p-3 text-sm">{sale.buyer_name} · Outstanding {money(
            Math.max(0,num(sale.final_sale_price)-num(chosenFinance?.verified_paid)))}</p>
          <Field label="Amount *"><input required type="number" min=".01" step=".01" className={input}
            value={value("amount")} onChange={e=>put("amount",e.target.value)}/></Field>
          <Field label="Paid on *"><input required type="date" max={today()} className={input}
            value={value("paid_on")} onChange={e=>put("paid_on",e.target.value)}/></Field>
          <Field label="Method *"><select className={input} value={value("method")}
            onChange={e=>put("method",e.target.value)}>{methods.map(x=><option key={x} value={x}>{x.toUpperCase()}</option>)}</select></Field>
          <Field label="Reference (required for non-cash)"><input required={value("method")!=="cash"}
            className={input} value={value("reference")} onChange={e=>put("reference",e.target.value)}/></Field>
          <Field label="Payer"><input className={input} value={value("payer")} onChange={e=>put("payer",e.target.value)}/></Field>
          <Field label="Notes"><textarea className={input+" min-h-20 py-2"} value={value("notes")}
            onChange={e=>put("notes",e.target.value)}/></Field>
          <Field label="Payment receipt / proof *"><input type="file" accept="application/pdf,image/jpeg,image/png" required disabled={busy} onChange={e=>{receiptUpload.clear();setProof(e.target.files?.[0]??null);}}/></Field>
          <Button type="submit" disabled={busy||!proof} className="w-full">{busy?"Uploading and saving…":"Record for verification"}</Button>
        </form>}
        {modal==="stage"&&sale&&<div className="space-y-3">
          <p className="rounded-lg bg-muted p-3 text-sm">{sale.buyer_name} · {labels[sale.status]}</p>
          {stages.indexOf(sale.status)>=0&&stages.indexOf(sale.status)<stages.length-1&&
            <Button className="w-full" disabled={busy} onClick={()=>void update("sales_set_stage",{
              _sale_id:sale.id,_status:stages[stages.indexOf(sale.status)+1],
            },"Sale advanced")}>Advance to {labels[stages[stages.indexOf(sale.status)+1] ?? ""]}</Button>}
          <p className="text-xs text-muted-foreground">Cancellation is a separate audited action under the booking row.</p>
        </div>}
        {(modal==="request"||modal==="cancel")&&sale&&<form className="space-y-3" onSubmit={e=>submit(e,
          modal==="request"?"sales_request_cancellation":"sales_cancel_booking",
          modal==="request"?{_sale_id:sale.id,_reason:value("reason")}:
            {_sale_id:sale.id,_reason:value("reason"),_fee:Number(value("fee"))},
          modal==="request"?"Cancellation request sent to management":"Booking cancelled; flat released")}>
          <p className="rounded-lg bg-muted p-3 text-sm">{sale.sale_number} · {sale.buyer_name} · Flat {sale.units?.unit_number}</p>
          <Field label="Cancellation reason (at least 10 characters) *"><textarea required minLength={10}
            className={input+" min-h-28 py-2"} value={value("reason")}
            onChange={e=>put("reason",e.target.value)}/></Field>
          {modal==="cancel"&&<>
            <p className="text-sm">Verified buyer collections: <b>{money(num(chosenFinance?.verified_paid))}</b></p>
            {num(chosenFinance?.reported_pending)>0&&<p className="rounded-lg border border-amber-500/40 p-3 text-sm text-amber-700">
              Review pending buyer receipts before cancellation. The database will block cancellation until they are resolved.</p>}
            <Field label="Approved cancellation charge / retained amount (₹) *">
              <input type="number" min="0" max={num(chosenFinance?.verified_paid)} step=".01" required
                className={input} value={value("fee")} onChange={e=>put("fee",e.target.value)}/>
            </Field>
            <p className="rounded-lg bg-muted p-3 text-sm">Refund obligation on cancellation:
              <strong className="ml-2">{money(Math.max(0,num(chosenFinance?.verified_paid)-Number(value("fee"))))}</strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                Cancellation preserves all receipts and releases the flat. Refund payments are recorded separately.
              </span>
            </p>
          </>}
          <Button type="submit" variant={modal==="cancel"?"destructive":"default"} className="w-full"
            disabled={busy||value("reason").trim().length<10||(modal==="cancel"&&(
              Number(value("fee"))>num(chosenFinance?.verified_paid)||Number(value("fee"))<0))}>
            {modal==="cancel"?"Confirm booking cancellation":"Submit cancellation request"}
          </Button>
        </form>}
        {modal==="decline"&&sale&&<form className="space-y-3" onSubmit={e=>submit(e,"sales_decline_cancellation",{
          _request_id:chosenFinance?.pending_cancel_request_id,_reason:value("reason"),
        },"Cancellation request declined")}>
          <p className="rounded-lg bg-muted p-3 text-sm">{chosenFinance?.pending_cancel_reason}</p>
          <Field label="Reason for declining *"><textarea required minLength={5}
            className={input+" min-h-20 py-2"} value={value("reason")}
            onChange={e=>put("reason",e.target.value)}/></Field>
          <Button type="submit" className="w-full" disabled={busy||value("reason").trim().length<5}>Decline request</Button>
        </form>}
        {modal==="refund"&&sale&&<form className="space-y-3" onSubmit={e=>submit(e,"sales_record_refund",{
          _sale_id:sale.id,_amount:Number(value("amount")),_refunded_on:value("refunded_on"),
          _method:value("method"),_reference:value("reference")||null,_notes:value("notes")||null,
        },"Refund entered in customer ledger")}>
          <p className="rounded-lg bg-muted p-3 text-sm">Refund outstanding:
            <b className="ml-2">{money(Math.max(0,num(chosenFinance?.refund_due)-num(chosenFinance?.refund_paid)))}</b>
          </p>
          <Field label="Amount actually refunded (₹) *"><input type="number" required min=".01"
            max={Math.max(0,num(chosenFinance?.refund_due)-num(chosenFinance?.refund_paid))}
            step=".01" className={input} value={value("amount")} onChange={e=>put("amount",e.target.value)}/></Field>
          <Field label="Refund date *"><input type="date" required max={today()}
            className={input} value={value("refunded_on")} onChange={e=>put("refunded_on",e.target.value)}/></Field>
          <Field label="Payment method *"><select className={input} value={value("method")}
            onChange={e=>put("method",e.target.value)}>
            {methods.filter(x=>x!=="card").map(x=><option key={x} value={x}>{x.toUpperCase()}</option>)}
          </select></Field>
          <Field label="Transaction reference * (unless cash)"><input className={input}
            required={value("method")!=="cash"} value={value("reference")}
            onChange={e=>put("reference",e.target.value)}/></Field>
          <Field label="Notes"><textarea className={input+" min-h-20 py-2"} value={value("notes")}
            onChange={e=>put("notes",e.target.value)}/></Field>
          <Button type="submit" className="w-full" disabled={busy}>Record actual refund</Button>
        </form>}
        {modal==="correct"&&sale&&<form className="space-y-3" onSubmit={e=>submit(e,
          "sales_correct_erroneous_stage",{
            _sale_id:sale.id,_reason:value("reason"),
            _confirmation:"I_CONFIRM_STAGE_ENTERED_IN_ERROR",
          },"Booking returned to Booked; correction audited")}>
          <p className="rounded-lg border border-amber-500/40 p-3 text-sm">
            Current stage: <strong>{labels[sale.status]}</strong>. This action returns the
            record to <strong>Booked</strong> because its stage was entered incorrectly.
            If an agreement, registration or handover actually occurred, use a
            formal legal cancellation process instead.
          </p>
          <Field label="Reason for wrong stage (at least 20 characters) *">
            <textarea className={input+" min-h-28 py-2"} required minLength={20}
              value={value("reason")} onChange={e=>put("reason",e.target.value)}/>
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={value("confirmed")==="yes"}
              onChange={e=>put("confirmed",e.target.checked?"yes":"")}/>
            I verified that this is only a clerical/test-stage mistake and no
            executed agreement, registration or possession needs to be reversed.
          </label>
          <Button type="submit" className="w-full" disabled={busy||
            value("reason").trim().length<20||value("confirmed")!=="yes"}>
            Return to Booked (audited correction)
          </Button>
        </form>}
        {modal==="history"&&sale&&<div className="space-y-3">
          <p className="rounded-lg bg-muted p-3 text-sm">{sale.sale_number} · {sale.buyer_name}</p>
          {events.isLoading&&<Loading/>}
          {events.isError&&<p className="text-sm text-destructive">{events.error.message}</p>}
          {events.data?.map(event=><div key={event.id} className="rounded-lg border p-3 text-xs">
            <p className="font-semibold">{event.action.replaceAll("_"," ")}
              <span className="ml-2 font-normal text-muted-foreground">{new Date(event.created_at).toLocaleString("en-IN")}</span></p>
            <p className="mt-1 break-words text-muted-foreground">{Object.entries(event.details??{})
              .filter(([key])=>!key.endsWith("_id")).map(([key,val])=>key.replaceAll("_"," ")+": "+String(val)).join(" · ")}</p>
          </div>)}
          {!events.isLoading&&!events.data?.length&&<p className="text-sm text-muted-foreground">No activity recorded.</p>}
        </div>}
      </DialogContent>
    </Dialog>
    <p className="text-xs text-muted-foreground">
      Source of truth: shared flat master. Lists are server-paginated and company/project permissions are enforced in the database.
      Refund entries document a completed payment; they never initiate a bank transaction.
    </p>
  </div>;
}
