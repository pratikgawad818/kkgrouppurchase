/**
 * Spreadsheet user input is never a direct inventory or finance mutation.
 * Historic entries are separate from the stock ledger and are identified by
 * a stable user-supplied Reference (e.g. LEGACY-0001).
 */
export const HISTORICAL_TAB = "ERP - Historical Consumption";
export const HISTORICAL_HEADERS = [
  "Reference", "Date (YYYY-MM-DD)", "Project Code", "Building Code",
  "Material Code", "Quantity", "Unit Cost INR", "Purpose",
  "ERP Record ID (do not edit)", "Sync Status", "Sync Error",
] as const;

export const EXPORT_TABS = [
  { name: "ERP - Projects", table: "projects", columns: "id,code,name,status", companyColumn: "company_id" },
  { name: "ERP - Materials", table: "items", columns: "id,code,name,status,unit_id", companyColumn: "company_id" },
  { name: "ERP - Vendors", table: "vendors", columns: "id,code,company_name,status", companyColumn: "company_id" },
  { name: "ERP - Warehouses", table: "warehouses", columns: "id,code,name,status,project_id", companyColumn: "company_id" },
  { name: "ERP - Buildings", table: "buildings", columns: "id,code,name,project_id", companyColumn: "company_id" },
  { name: "ERP - Purchase Requests", table: "purchase_requests", columns: "id,pr_number,status,project_id,created_at", companyColumn: "company_id" },
  { name: "ERP - Purchase Orders", table: "purchase_orders", columns: "id,po_number,status,project_id,created_at", companyColumn: "company_id" },
  { name: "ERP - Goods Received", table: "goods_receipt_notes", columns: "id,grn_number,status,created_at", companyColumn: "company_id" },
  { name: "ERP - Material Issues", table: "material_issues", columns: "id,issue_number,issue_date,project_id,building_id,warehouse_id", companyColumn: "company_id" },
  { name: "ERP - Vendor Invoices", table: "vendor_invoices", columns: "id,invoice_number,status,created_at", companyColumn: "company_id" },
  { name: "ERP - Vendor Payments", table: "vendor_payments", columns: "id,status,created_at", companyColumn: "company_id" },
] as const;

export function parseSpreadsheetId(value: string): string {
  const input = value.trim();
  const match = input.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{25,})(?:\/[^?#]*)?(?:[?#].*)?$/);
  if (!match) throw new Error("Paste a full Google Sheets URL from docs.google.com/spreadsheets/d/…");
  return match[1]!;
}

export type HistoricalInput = {
  reference: string; date: string; projectCode: string; buildingCode: string;
  materialCode: string; quantity: number; unitCost: number; purpose: string;
};
export function parseHistoricalRow(row: readonly unknown[]): HistoricalInput {
  const cell = (i: number) => String(row[i] ?? "").trim();
  const reference = cell(0);
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(reference))
    throw new Error("Reference must be 2–64 letters, numbers, hyphens or underscores.");
  const date = cell(1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date + "T00:00:00Z")) ||
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)
    throw new Error("Date must be a real date in YYYY-MM-DD format.");
  const projectCode = cell(2), buildingCode = cell(3), materialCode = cell(4);
  if (!projectCode || !materialCode) throw new Error("Project Code and Material Code are required.");
  const quantity = Number(cell(5));
  const unitCost = cell(6) === "" ? 0 : Number(cell(6));
  if (!cell(5) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 ||
    Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.00001)
    throw new Error("Quantity must be positive with at most 3 decimal places.");
  if (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 1_000_000_000 ||
    Math.abs(unitCost * 100 - Math.round(unitCost * 100)) > 0.00001)
    throw new Error("Unit cost must be a nonnegative amount with at most 2 decimal places.");
  const purpose = cell(7).slice(0, 500);
  return { reference, date, projectCode, buildingCode, materialCode, quantity, unitCost, purpose };
}
export function canonicalHistorical(row: HistoricalInput): string {
  return JSON.stringify([
    row.reference, row.date, row.projectCode, row.buildingCode,
    row.materialCode, row.quantity, row.unitCost, row.purpose,
  ]);
}
export function decideHistoricalConflict(previous: string | null, erp: string | null, sheet: string) {
  if (erp === null) return "import" as const;
  if (erp === sheet) return "unchanged" as const;
  if (previous === null) return "conflict" as const;
  if (erp !== previous && sheet !== previous) return "conflict" as const;
  return erp !== previous ? "export" as const : "import" as const;
}


export const SHEET_ENTRY_TABS = [
  { kind: "costing", name: "Entry - Project Costing", statusIndex: 13,
    headers: ["Reference","Date (YYYY-MM-DD)","Project Code","Building Code","Cost Category","Vendor Code (optional)","Description","Quantity","Unit Rate INR","Amount INR","Invoice/Challan Ref (optional)","Payment Method","Remarks","ERP Record ID (do not edit)","Import Status","Import Error"] },
  { kind: "challan", name: "Entry - Vendor Challans", statusIndex: 13,
    headers: ["Import Reference","Challan Number","Challan Date (YYYY-MM-DD)","Vendor Code","PO Number","Project Code","Building Code","PO Line No","Material Code","Dispatched Quantity","Vehicle Number","Invoice Reference","Remarks","ERP Record ID (do not edit)","Import Status","Import Error"] },
  { kind: "invoice", name: "Entry - Vendor Invoices", statusIndex: 18,
    headers: ["Import Reference","Vendor Invoice Number","Invoice Date (YYYY-MM-DD)","Due Date (YYYY-MM-DD)","Vendor Code","PO Number","GRN Number","GRN Line No","Material Code","Invoiced Quantity","Rate INR","Tax Type","Tax Rate %","Freight INR (first line)","Other Charges INR (first line)","TDS Section","TDS Rate %","Remarks","ERP Record ID (do not edit)","Import Status","Import Error"] },
] as const;
export type SheetEntryKind = typeof SHEET_ENTRY_TABS[number]["kind"];
export type SheetEntryDocument = { kind:SheetEntryKind; reference:string; rows:number[]; payload:Record<string,unknown> };
export type SheetEntryError = { row:number; message:string };
function cell(row:readonly unknown[],i:number) { return String(row[i]??"").trim(); }
function entryReference(value:string):string {
  const key=value.toUpperCase();
  if(!/^[A-Z0-9_-]{2,64}$/.test(key))throw new Error("Import Reference must contain 2–64 letters, numbers, underscores or hyphens.");
  return key;
}
function code(value:string,name:string,optional=false):string {
  const c=value.trim().toUpperCase();
  if(optional&&!c)return "";
  if(!/^[A-Z0-9_.-]{1,80}$/.test(c))throw new Error(name+" must be an existing ERP code/number.");
  return c;
}
function sheetDate(value:string,name:string,optional=false):string {
  if(optional&&!value)return "";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value+"T00:00:00Z")) ||
    new Date(value+"T00:00:00Z").toISOString().slice(0,10)!==value)
    throw new Error(name+" must be a real YYYY-MM-DD date.");
  return value;
}
function amount(value:string,name:string,required=true,min=0,max=1_000_000_000,precision=2):number|null {
  if(!value&&!required)return null;
  if(!value || !/^\d+(?:\.\d+)?$/.test(value))throw new Error(name+" must be a positive numeric value.");
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>max||Math.abs(n*10**precision-Math.round(n*10**precision))>0.00001)
    throw new Error(name+" is out of range or has too many decimals.");
  return n;
}
function textValue(value:string,name:string,max=500,required=false):string {
  if((required&&!value)||value.length>max)throw new Error(name+" is missing or too long.");
  return value;
}
function sameHeader(rows:readonly (readonly string[])[], indexes:number[], name:string) {
  for(const ix of indexes){
    const first=cell(rows[0]!,ix).toUpperCase();
    for(const row of rows.slice(1)){
      const next=cell(row,ix).toUpperCase();
      if(next && next!==first)throw new Error(name+" has contradictory values on lines sharing one Import Reference.");
    }
  }
}
function parseEntryDocument(kind:SheetEntryKind, reference:string, rows:readonly (readonly string[])[]):Record<string,unknown> {
  const r=rows[0]!;
  if(kind==="costing"){
    if(rows.length!==1)throw new Error("Costing needs one line per unique Reference.");
    const quantity=amount(cell(r,7),"Quantity",false,0.001,1_000_000,3);
    const unitRate=amount(cell(r,8),"Unit Rate",false);
    const billed=amount(cell(r,9),"Amount",false,0.01);
    const calculated=quantity!==null&&unitRate!==null?Math.round(quantity*unitRate*100)/100:null;
    if(billed===null&&calculated===null)throw new Error("Enter Amount or both Quantity and Unit Rate.");
    if(billed!==null&&calculated!==null&&Math.abs(billed-calculated)>0.01)
      throw new Error("Amount does not match Quantity × Unit Rate.");
    return {reference,date:sheetDate(cell(r,1),"Cost date"),projectCode:code(cell(r,2),"Project Code"),
      buildingCode:code(cell(r,3),"Building Code",true),
      category:textValue(cell(r,4),"Cost category",80,true).toLowerCase(),
      vendorCode:code(cell(r,5),"Vendor Code",true),
      description:textValue(cell(r,6),"Description",500,true),
      quantity,unitRate,amount:billed??calculated,relatedDocument:textValue(cell(r,10),"Related document",120),
      paymentMethod:textValue(cell(r,11),"Payment Method",30).toLowerCase(),
      remarks:textValue(cell(r,12),"Remarks",500)};
  }
  if(kind==="challan"){
    sameHeader(rows,[1,2,3,4,5,6,10,11,12],"Challan");
    const items=rows.map(line=>({
      poLineNo:amount(cell(line,7),"PO Line No",true,1,10000,0)!,
      materialCode:code(cell(line,8),"Material Code"),
      quantity:amount(cell(line,9),"Dispatched Quantity",true,0.001,1_000_000,3)!,
    }));
    if(new Set(items.map(x=>x.poLineNo)).size!==items.length)
      throw new Error("Each PO Line No may appear once in one challan.");
    return {reference,challanNumber:textValue(cell(r,1),"Challan number",100,true),
      date:sheetDate(cell(r,2),"Challan date"),vendorCode:code(cell(r,3),"Vendor Code"),
      poNumber:code(cell(r,4),"PO Number"),projectCode:code(cell(r,5),"Project Code"),
      buildingCode:code(cell(r,6),"Building Code",true),
      vehicleNumber:textValue(cell(r,10),"Vehicle Number",80),
      invoiceReference:textValue(cell(r,11),"Invoice Reference",100),
      remarks:textValue(cell(r,12),"Remarks",500),items};
  }
  sameHeader(rows,[1,2,3,4,5,15,16,17],"Invoice");
  const items=rows.map(line=>({
    grnNumber:code(cell(line,6),"GRN Number"),
    grnLineNo:amount(cell(line,7),"GRN Line No",false,1,10000,0),
    materialCode:code(cell(line,8),"Material Code"),
    quantity:amount(cell(line,9),"Invoiced Quantity",true,0.001,1_000_000,3)!,
    rate:amount(cell(line,10),"Rate INR",true,0)!,
    taxType:textValue(cell(line,11),"Tax Type",15,true),
    taxRate:amount(cell(line,12),"Tax Rate",true,0,100)!,
  }));
  if(items.some(x=>!["cgst_sgst","igst","none"].includes(x.taxType)))
    throw new Error("Tax Type must be cgst_sgst, igst or none.");
  if(items.some(x=>x.taxType==="none"&&x.taxRate!==0))
    throw new Error("Tax Rate must be 0 when Tax Type is none.");
  if(rows.slice(1).some(line=>cell(line,13)||cell(line,14)))
    throw new Error("Freight and Other Charges must be entered on the first invoice line only.");
  return {reference,vendorInvoiceNumber:textValue(cell(r,1),"Vendor invoice number",100,true),
    date:sheetDate(cell(r,2),"Invoice date"),dueDate:sheetDate(cell(r,3),"Due date",true),
    vendorCode:code(cell(r,4),"Vendor Code"),poNumber:code(cell(r,5),"PO Number"),
    freight:amount(cell(r,13),"Freight",false)??0,
    otherCharges:amount(cell(r,14),"Other Charges",false)??0,
    tdsSection:textValue(cell(r,15),"TDS Section",80),
    tdsRate:amount(cell(r,16),"TDS Rate",false,0,100,3)??0,
    remarks:textValue(cell(r,17),"Remarks",500),items};
}
export function parseEntrySheet(kind:SheetEntryKind, sheet:readonly (readonly string[])[]) {
  const tab=SHEET_ENTRY_TABS.find(t=>t.kind===kind)!;
  if(!sheet.length)return {documents:[] as SheetEntryDocument[], errors:[] as SheetEntryError[]};
  if(tab.headers.some((h,i)=>sheet[0]?.[i]!==h))
    throw new Error(tab.name+" header does not match the approved import template.");
  const groups=new Map<string,{rows:string[][];numbers:number[]}>();
  const errors:SheetEntryError[]=[];
  const rows=sheet.slice(1);
  for(let i=0;i<rows.length;i++){
    const row=rows[i]!;
    if(!row.slice(0,tab.statusIndex).some(x=>String(x??"").trim()))continue;
    try{
      const ref=entryReference(cell(row,0));
      const group=groups.get(ref)??{rows:[],numbers:[]};
      group.rows.push(row.map(x=>String(x??"")));
      group.numbers.push(i+2);
      groups.set(ref,group);
    }catch(e){errors.push({row:i+2,message:e instanceof Error?e.message:"Invalid reference"});}
  }
  const documents:SheetEntryDocument[]=[];
  for(const [reference,group] of groups){
    try{
      const payload=parseEntryDocument(kind,reference,group.rows);
      documents.push({kind,reference,rows:group.numbers,payload});
    }catch(e){for(const row of group.numbers)errors.push({row,message:e instanceof Error?e.message:"Invalid entry"});}
  }
  return {documents,errors};
}
