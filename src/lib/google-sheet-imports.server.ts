import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readValues, writeValues, writeEntryStatuses, exportReferenceTab } from "@/lib/google-sheets.server";
import { SHEET_ENTRY_TABS, parseEntrySheet, parseClipboardGrid, type SheetEntryKind } from "@/lib/google-sheets-model";

const db = supabaseAdmin as unknown as SupabaseClient;
const hash=(v:object)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
type StageRow={id:string;document_type:SheetEntryKind;source_reference:string;source_hash:string;source_type:"google"|"paste";
  payload:Record<string,unknown>;status:string;erp_record_id:string|null;error_message:string|null};
type Status={row:number;recordId:string;status:string;error:string};
type Master={id:string;code:string};
type Listed={id:string; grn_id?:string; grn_number?:string; material_id?:string; accepted_quantity?:number; po_item_id?:string; status?:string; vendor_id?:string; po_id?:string; project_id?:string; building_id?:string|null; line_no?:number; [key:string]:unknown};
function failure(error:unknown):string{return error instanceof Error?error.message:"Unexpected ERP error";}
async function one(table:string, filters:Record<string,string>,columns="id"):Promise<Listed> {
  let query=db.from(table).select(columns);
  for(const [field,val] of Object.entries(filters))query=query.eq(field,val);
  const {data,error}=await query.limit(2);
  if(error)throw new Error(table+": "+error.message);
  if(data?.length!==1)throw new Error("Expected exactly one "+table+" for "+Object.entries(filters).map(([k,v])=>k+"="+v).join(", ")+".");
  return data[0] as unknown as Listed;
}
async function rows(table:string,filters:Record<string,string>,columns:string):Promise<Listed[]> {
  let query=db.from(table).select(columns);
  for(const [field,val] of Object.entries(filters))query=query.eq(field,val);
  const {data,error}=await query.limit(2000);
  if(error)throw new Error(table+": "+error.message);
  if((data?.length??0)>=2000)throw new Error("Too many matching "+table+" lines. Narrow the document.");
  return (data??[]) as unknown as Listed[];
}
export async function stageSheetEntries(companyId:string,spreadsheetId:string) {
  const errors:Record<string,string>={};
  const summaries:Record<string,{ready:number;applied:number;invalid:number;conflicts:number}>={};
  let staged=0;
  for(const tab of SHEET_ENTRY_TABS){
    let ready=0,applied=0,invalid=0,conflicts=0;
    try{
      let sheet=await readValues(companyId,spreadsheetId,tab.name,"A1:U1501");
      if(!sheet.length){
        await writeValues(companyId,spreadsheetId,tab.name,"A1:U1",[[...tab.headers]]);
        sheet=[[...tab.headers]];
      }
      if(sheet.length>=1501)throw new Error("Entry tab exceeds 1,500 rows. Archive or split before importing.");
      const parsed=parseEntrySheet(tab.kind,sheet);
      const updates:Status[]=parsed.errors.map(e=>({row:e.row,recordId:"",status:"ERROR",error:e.message.slice(0,240)}));
      invalid+=parsed.errors.length;
      const {data:existing,error:lookupError}=await db.from("erp_sheet_import_documents")
        .select("id,document_type,source_reference,source_hash,source_type,payload,status,erp_record_id,error_message")
        .eq("company_id",companyId).eq("document_type",tab.kind).limit(5000);
      if(lookupError)throw lookupError;
      const known=new Map<string,StageRow>((existing as StageRow[]??[]).map(d=>[d.source_reference,d]));
      for(const doc of parsed.documents){
        const computed=hash(doc.payload);
        const old=known.get(doc.reference);
        if(old?.source_type==="paste"){
          for(const row of doc.rows) updates.push({row,recordId:old.erp_record_id??"",status:"ERROR",
            error:"This reference was already submitted by the direct paste importer. Choose a new reference."});
          invalid+=doc.rows.length;
          continue;
        }
        let current:StageRow|undefined;
        if(old&&old.source_hash!==computed&&(old.status==="applied"||old.status==="conflict")){
          conflicts++;
          const {error}=await db.from("erp_sheet_import_documents").update({
            status:"conflict",error_message:"This document was already imported. Edit in ERP using a controlled correction; do not overwrite the posted import.",last_seen_at:new Date().toISOString(),
          }).eq("company_id",companyId).eq("id",old.id);
          if(error)throw error;
          current={...old,status:"conflict",error_message:"Already imported; spreadsheet data changed."};
        } else if(old&&(old.status==="applied"||old.status==="conflict"||old.status==="processing"||old.source_hash===computed)){
          current=old;
          // Existing apply errors are intentionally retained so staff can retry.
        } else {
          const {data,error}=await db.from("erp_sheet_import_documents").upsert({
            company_id:companyId,document_type:tab.kind,source_reference:doc.reference,source_type:"google",
            source_hash:computed,payload:doc.payload,status:"ready",error_message:null,
            last_seen_at:new Date().toISOString(),
          },{onConflict:"company_id,document_type,source_reference"})
            .select("id,document_type,source_reference,source_hash,source_type,payload,status,erp_record_id,error_message").single();
          if(error||!data)throw new Error("ERP import queue failed: "+(error?.message??"unknown"));
          current=data as StageRow;staged++;
        }
        if(current.status==="ready")ready++;
        if(current.status==="applied")applied++;
        if(current.status==="conflict")conflicts++;
        const status=current.status==="ready"?"READY":current.status.toUpperCase();
        for(const row of doc.rows)updates.push({row,recordId:current.erp_record_id??"",
          status,error:(current.error_message??"").slice(0,240)});
      }
      await writeEntryStatuses(companyId,spreadsheetId,tab.name,tab.statusIndex,updates);
    }catch(err){errors[tab.name]=failure(err);}
    summaries[tab.name]={ready,applied,invalid,conflicts};
  }
  return {staged,summaries,errors};
}
/**
 * No-Google-client mode: the Super Admin pastes a copy of a restricted
 * Google Sheet's cells. This creates reviewed, non-posted ERP queue documents.
 * This is a point-in-time snapshot, not an automatic background sync.
 */
export async function stagePastedEntries(companyId:string,kind:SheetEntryKind,clipboard:string) {
  const tab=SHEET_ENTRY_TABS.find(t=>t.kind===kind);
  if(!tab)throw new Error("Unknown spreadsheet import type.");
  const grid=parseClipboardGrid(clipboard);
  const parsed=parseEntrySheet(kind,grid);
  const references=parsed.documents.map(d=>d.reference);
  if(new Set(references).size!==references.length)throw new Error("Duplicate import references in the pasted selection.");
  let existing:StageRow[]=[];
  for(let index=0;index<references.length;index+=100) {
    const keys=references.slice(index,index+100);
    const {data,error}=await db.from("erp_sheet_import_documents")
      .select("id,document_type,source_reference,source_hash,source_type,payload,status,erp_record_id,error_message")
      .eq("company_id",companyId).eq("document_type",kind).in("source_reference",keys);
    if(error)throw new Error("Could not verify existing ERP entries: "+error.message);
    existing.push(...(data as StageRow[]??[]));
  }
  const known=new Map(existing.map(x=>[x.source_reference,x]));
  const rowErrors=[...parsed.errors];
  let added=0,updated=0,unchanged=0;
  const inserts:Record<string,unknown>[]=[];
  const updates:{id:string;hash:string;oldHash:string;payload:Record<string,unknown>}[]=[];
  for(const doc of parsed.documents){
    const current=known.get(doc.reference);
    const value=hash(doc.payload);
    if(current?.source_type==="google"){
      for(const row of doc.rows)rowErrors.push({row,message:"This reference belongs to an authorized Google import. Use a unique reference."});
      continue;
    }
    if(current?.status==="applied"){
      for(const row of doc.rows)rowErrors.push({row,message:
        current.source_hash===value?"Already imported as "+current.erp_record_id:
          "The reference was already applied. Existing ERP documents cannot be overwritten."});
      continue;
    }
    if(current?.status==="processing"||current?.status==="conflict"){
      for(const row of doc.rows)rowErrors.push({row,message:"The reference is processing or in conflict. Reconcile it before resubmitting."});
      continue;
    }
    if(current){
      if(current.source_hash===value){unchanged++;continue;}
      updates.push({id:current.id,hash:value,oldHash:current.source_hash,payload:doc.payload});
    }else {
      inserts.push({company_id:companyId,document_type:kind,source_type:"paste",
        source_reference:doc.reference,source_hash:value,payload:doc.payload,
        status:"ready",error_message:null});
    }
  }
  if(inserts.length){
    const {error}=await db.from("erp_sheet_import_documents").insert(inserts);
    if(error)throw new Error("Could not save pasted ERP queue. No new records were accepted in this batch: "+error.message);
    added=inserts.length;
  }
  for(const item of updates){
    const {data,error}=await db.from("erp_sheet_import_documents").update({
      source_hash:item.hash,payload:item.payload,status:"ready",error_message:null,
      last_seen_at:new Date().toISOString(),
    }).eq("id",item.id).eq("company_id",companyId).eq("source_type","paste")
      .eq("source_hash",item.oldHash).in("status",["ready","error"]).select("id").maybeSingle();
    if(error||!data)throw new Error("A pasted entry changed concurrently. Refresh the import queue and retry.");
    updated++;
  }
  return {kind,added,updated,unchanged,rejected:rowErrors.length,rowErrors:rowErrors.slice(0,80)};
}

export async function exportGrnItemReferences(companyId:string, spreadsheetId:string, materials:Master[]) {
  const grns=await rows("goods_receipt_notes",{company_id:companyId},"id,grn_number,po_id,status");
  if(grns.length>=2000)throw new Error("More than 2,000 goods receipts; split reference export.");
  const materialById=new Map(materials.map(i=>[i.id,i.code]));
  const exported:(string|number)[][]=[];
  const byGrn=new Map<string,Listed[]>();
  const ids=grns.map(x=>x.id);
  for(let start=0;start<ids.length;start+=100) {
    const {data,error}=await db.from("goods_receipt_items")
      .select("id,grn_id,po_item_id,material_id,accepted_quantity")
      .in("grn_id",ids.slice(start,start+100)).limit(10000);
    if(error)throw error;
    if((data?.length??0)>=10000)throw new Error("Too many GRN lines for one export batch.");
    for(const item of (data??[]) as unknown as Listed[]){
      const list=byGrn.get(String(item.grn_id))??[];
      list.push(item);byGrn.set(String(item.grn_id),list);
    }
  }
  for(const grn of grns){
    const items=(byGrn.get(String(grn.id))??[]).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    for(let i=0;i<items.length;i++){
      const row=items[i]!;
      exported.push([String(grn.grn_number),i+1,materialById.get(String(row.material_id))??"",
        Number(row.accepted_quantity),String(row.id),String(row.po_item_id),String(grn.status)]);
    }
  }
  await exportReferenceTab(companyId,spreadsheetId,"ERP - GRN Item References",
    ["GRN Number","GRN Line No","Material Code","Accepted Quantity","ERP GRN Item ID","ERP PO Item ID","GRN Status"],exported);
}
type CostPayload={reference:string;date:string;projectCode:string;buildingCode:string;
  category:string;vendorCode:string;description:string;quantity:number|null;unitRate:number|null;
  amount:number;relatedDocument:string;paymentMethod:string;remarks:string};
type ChallanPayload={reference:string;challanNumber:string;date:string;vendorCode:string;poNumber:string;
  projectCode:string;buildingCode:string;vehicleNumber:string;invoiceReference:string;remarks:string;
  items:{poLineNo:number;materialCode:string;quantity:number}[]};
type InvoicePayload={reference:string;vendorInvoiceNumber:string;date:string;dueDate:string;vendorCode:string;
  poNumber:string;freight:number;otherCharges:number;tdsSection:string;tdsRate:number;remarks:string;
  items:{grnNumber:string;grnLineNo:number|null;materialCode:string;quantity:number;rate:number;
    taxType:string;taxRate:number}[]};
async function selectedPo(companyId:string,poNumber:string,vendorCode:string) {
  const po=await one("purchase_orders",{company_id:companyId,po_number:poNumber},
    "id,company_id,vendor_id,project_id,building_id,status");
  const vendor=await one("vendors",{company_id:companyId,code:vendorCode},"id");
  if(po.vendor_id!==vendor.id)throw new Error("Vendor Code is not the supplier on this purchase order.");
  return po;
}
export async function applySheetEntry(companyId:string,actorId:string,client:SupabaseClient,id:string) {
  const {data,error}=await db.from("erp_sheet_import_documents")
    .select("id,company_id,document_type,source_reference,source_hash,source_type,payload,status,erp_record_id,error_message")
    .eq("company_id",companyId).eq("id",id).maybeSingle();
  if(error||!data)throw new Error("Import not found in your company.");
  const initial=data as StageRow;
  if(initial.status==="applied")return {id:initial.erp_record_id??"",status:"applied"};
  if(initial.status==="conflict")throw new Error("Already-imported entry was changed in the sheet. Reconciliation is required.");
  const tab=SHEET_ENTRY_TABS.find(t=>t.kind===initial.document_type)!;
  let liveRows:number[]=[];
  let googleSpreadsheetId:string|null=null;
  if(initial.source_type==="google"){
    const {data:connection,error:connectionError}=await db.from("erp_google_sheet_connections")
      .select("spreadsheet_id,enabled").eq("company_id",companyId).single();
    if(connectionError||!connection?.enabled)throw new Error("Connect and enable Google Sheets before importing.");
    googleSpreadsheetId=String(connection.spreadsheet_id);
    // Authorized Google-sync imports must re-read the current workbook before posting.
    const liveSheet=await readValues(companyId,googleSpreadsheetId,tab.name,"A1:U1501");
    const parsed=parseEntrySheet(tab.kind,liveSheet);
    const live=parsed.documents.find(d=>d.reference===initial.source_reference);
    if(!live||hash(live.payload)!==initial.source_hash)
      throw new Error("Spreadsheet entry was removed or changed. Sync and review it again before importing.");
    liveRows=live.rows;
  }else if(initial.source_type!=="paste"){
    throw new Error("Unsupported import source.");
  }
  const {data:current}=await db.from("erp_sheet_import_documents").select("source_hash,status")
    .eq("company_id",companyId).eq("id",id).single();
  if(!current||current.source_hash!==initial.source_hash||current.status==="conflict")
    throw new Error("The staging queue changed. Sync before importing.");
  const claimed=await db.from("erp_sheet_import_documents").update({status:"processing",error_message:null})
    .eq("company_id",companyId).eq("id",id).in("status",["ready","error"])
    .select("id").maybeSingle();
  if(claimed.error||!claimed.data)throw new Error("Another import is processing this record or it is already applied.");
  try{
    let erpId="";
    if(initial.document_type==="costing"){
      const p=initial.payload as CostPayload;
      const project=await one("projects",{company_id:companyId,code:p.projectCode},"id");
      const building=p.buildingCode?await one("buildings",{project_id:project.id,code:p.buildingCode},"id"):null;
      const vendor=p.vendorCode?await one("vendors",{company_id:companyId,code:p.vendorCode},"id"):null;
      if(p.relatedDocument)throw new Error("Costing linked to an invoice/challan must be reconciled in ERP first, to prevent double-counting.");
      const {data:created,error:costError}=await db.from("erp_project_cost_entries").insert({
        company_id:companyId,sheet_import_id:id,source_reference:p.reference,spent_on:p.date,
        project_id:project.id,building_id:building?.id??null,category:p.category,vendor_id:vendor?.id??null,
        description:p.description,quantity:p.quantity,unit_rate:p.unitRate,amount:p.amount,
        related_document:p.relatedDocument||null,payment_method:p.paymentMethod||null,
        remarks:p.remarks||null,created_by:actorId,
      }).select("id").single();
      if(costError||!created)throw new Error(costError?.message??"Cost save failed.");
      erpId=String(created.id);
    } else if(initial.document_type==="challan"){
      const p=initial.payload as ChallanPayload;
      const po=await selectedPo(companyId,p.poNumber,p.vendorCode);
      const project=await one("projects",{company_id:companyId,code:p.projectCode},"id");
      if(project.id!==po.project_id)throw new Error("Project Code is not the PO project.");
      if(p.buildingCode){
        const building=await one("buildings",{project_id:project.id,code:p.buildingCode},"id");
        if(po.building_id!==building.id)throw new Error("Building Code is not the PO building.");
      }else if(po.building_id)throw new Error("A Building Code is required for this PO.");
      const {data:duplicate}=await db.from("vendor_delivery_challans").select("id")
        .eq("company_id",companyId).eq("vendor_id",po.vendor_id).eq("challan_number",p.challanNumber).limit(1);
      if(duplicate?.length)throw new Error("Vendor challan already exists in ERP. Reconcile rather than importing twice.");
      const poLines=await rows("purchase_order_items",{po_id:po.id},"id,line_no,material_id,ordered_quantity");
      const mapped=[];
      for(const line of p.items){
        const poLine=poLines.find(x=>Number(x.line_no)===line.poLineNo);
        if(!poLine)throw new Error("PO Line No "+line.poLineNo+" was not found.");
        const material=await one("items",{company_id:companyId,code:line.materialCode},"id");
        if(poLine.material_id!==material.id)throw new Error("Material Code does not match PO line "+line.poLineNo+".");
        mapped.push({po_item_id:poLine.id,quantity:line.quantity});
      }
      const result=await client.rpc("register_vendor_delivery_challan",{
        _po_id:po.id,_header:{challan_number:p.challanNumber,challan_date:p.date,
          vehicle_number:p.vehicleNumber,invoice_reference:p.invoiceReference,remarks:p.remarks},
        _items:mapped,
      });
      if(result.error||!result.data)throw new Error(result.error?.message??"Challan RPC did not return an ID.");
      erpId=String(result.data);
    } else {
      const p=initial.payload as InvoicePayload;
      const po=await selectedPo(companyId,p.poNumber,p.vendorCode);
      const {data:duplicate}=await db.from("vendor_invoices").select("id")
        .eq("company_id",companyId).eq("vendor_id",po.vendor_id)
        .ilike("vendor_invoice_number",p.vendorInvoiceNumber).limit(1);
      if(duplicate?.length)throw new Error("A vendor invoice with this bill number already exists. Reconcile before retrying.");
      const mapped=[];
      const selected=new Set<string>();
      for(const line of p.items){
        const grn=await one("goods_receipt_notes",{company_id:companyId,grn_number:line.grnNumber},
          "id,po_id,status");
        if(grn.po_id!==po.id||grn.status!=="posted")
          throw new Error("GRN "+line.grnNumber+" is not a posted receipt for this PO.");
        const items=await rows("goods_receipt_items",{grn_id:grn.id},
          "id,grn_id,po_item_id,material_id,accepted_quantity");
        items.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
        const material=await one("items",{company_id:companyId,code:line.materialCode},"id");
        let item:Listed|undefined;
        if(line.grnLineNo!==null){
          item=items[line.grnLineNo-1];
          if(!item||item.material_id!==material.id)
            throw new Error("GRN Line No "+line.grnLineNo+" doesn't match "+line.materialCode+" in "+line.grnNumber+".");
        } else {
          const matches=items.filter(x=>x.material_id===material.id);
          if(matches.length!==1)throw new Error("Enter GRN Line No from ERP - GRN Item References to identify this material unambiguously.");
          item=matches[0];
        }
        if(!item)throw new Error("GRN item was not found.");
        if(selected.has(item.id))throw new Error("The same GRN item cannot be invoiced twice in one imported bill.");
        selected.add(item.id);
        mapped.push({grn_item_id:item.id,quantity:line.quantity,rate:line.rate,
          tax_type:line.taxType,tax_rate_percent:line.taxRate});
      }
      const result=await client.rpc("save_vendor_invoice",{
        _id:null,_header:{po_id:po.id,vendor_invoice_number:p.vendorInvoiceNumber,
          vendor_invoice_date:p.date,due_date:p.dueDate,freight:p.freight,
          other_charges:p.otherCharges,tds_section:p.tdsSection,tds_rate:p.tdsRate,remarks:p.remarks},
        _items:mapped,
      });
      if(result.error||!result.data)throw new Error(result.error?.message??"Invoice RPC did not return an ID.");
      erpId=String(result.data);
    }
    const result=await db.from("erp_sheet_import_documents").update({
      status:"applied",error_message:null,erp_record_id:erpId,applied_by:actorId,
      applied_at:new Date().toISOString(),
    }).eq("id",id).eq("company_id",companyId).eq("status","processing").select("id").maybeSingle();
    if(result.error||!result.data)
      throw new Error("ERP record was created but import confirmation failed. Contact admin; do not retry before reconciliation.");
    if(googleSpreadsheetId){
      try {
        await writeEntryStatuses(companyId,googleSpreadsheetId,tab.name,tab.statusIndex,
          liveRows.map(row=>({row,recordId:erpId,status:"IMPORTED",error:""})));
      }catch(writeError){console.error("Spreadsheet status update needs retry:",failure(writeError));}
    }
    return {id:erpId,status:"applied"};
  }catch(error){
    await db.from("erp_sheet_import_documents").update({
      status:"error",error_message:failure(error).slice(0,500),
    }).eq("id",id).eq("company_id",companyId).eq("status","processing");
    throw error;
  }
}
export async function listSheetImports(companyId:string){
  const {data,error}=await db.from("erp_sheet_import_documents")
    .select("id,document_type,source_type,source_reference,payload,status,error_message,erp_record_id,created_at,applied_at")
    .eq("company_id",companyId).order("created_at",{ascending:false}).limit(250);
  if(error)throw new Error(error.message);
  return data??[];
}
